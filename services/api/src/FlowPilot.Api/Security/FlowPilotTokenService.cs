using System.Collections.Concurrent;
using System.Security.Claims;
using System.Security.Cryptography;
using System.Text;
using System.Text.Encodings.Web;
using System.Text.Json;
using FlowPilot.Api.Data.Entities;
using Microsoft.AspNetCore.Authentication;
using Microsoft.AspNetCore.Identity;
using Microsoft.Extensions.Options;

namespace FlowPilot.Api.Security;

public sealed record TokenPayload(
    string Jti,
    string UserId,
    string Email,
    string DisplayName,
    long ExpiresAtUnixSeconds);

public sealed class FlowPilotTokenService(IConfiguration configuration)
{
    public const string SchemeName = "FlowPilotBearer";

    private readonly ConcurrentDictionary<string, long> _revokedTokens = new();
    private readonly PasswordHasher<UserEntity> _passwordHasher = new();

    private byte[] GetSigningKeyBytes()
    {
        var configuredSecret = configuration["Auth:SigningKey"];
        if (string.IsNullOrWhiteSpace(configuredSecret))
        {
            configuredSecret = "flowpilot-dev-hmac-sha256-signing-key-placeholder-min-32-bytes";
        }
        return Encoding.UTF8.GetBytes(configuredSecret);
    }

    public string HashPassword(UserEntity user, string plainPassword)
    {
        return _passwordHasher.HashPassword(user, plainPassword);
    }

    public bool VerifyPassword(UserEntity user, string hashedPassword, string plainPassword)
    {
        var result = _passwordHasher.VerifyHashedPassword(user, hashedPassword, plainPassword);
        return result is PasswordVerificationResult.Success or PasswordVerificationResult.SuccessRehashNeeded;
    }

    public (string Token, DateTimeOffset ExpiresAtUtc) IssueToken(UserEntity user)
    {
        var lifetimeMinutes = configuration.GetValue<int?>("Auth:TokenLifetimeMinutes") ?? 1440;
        var expiresAt = DateTimeOffset.UtcNow.AddMinutes(Math.Max(5, lifetimeMinutes));

        var payload = new TokenPayload(
            Jti: Guid.NewGuid().ToString("N"),
            UserId: user.Id,
            Email: user.Email,
            DisplayName: user.DisplayName,
            ExpiresAtUnixSeconds: expiresAt.ToUnixTimeSeconds());

        var payloadBytes = JsonSerializer.SerializeToUtf8Bytes(payload);
        var payloadB64 = Base64UrlEncode(payloadBytes);

        using var hmac = new HMACSHA256(GetSigningKeyBytes());
        var sigBytes = hmac.ComputeHash(Encoding.ASCII.GetBytes(payloadB64));
        var sigB64 = Base64UrlEncode(sigBytes);

        return ($"{payloadB64}.{sigB64}", expiresAt);
    }

    public TokenPayload? ValidateToken(string rawToken)
    {
        if (string.IsNullOrWhiteSpace(rawToken))
        {
            return null;
        }

        var parts = rawToken.Split('.');
        if (parts.Length != 2)
        {
            return null;
        }

        var payloadB64 = parts[0];
        var sigB64 = parts[1];

        byte[] expectedSigBytes;
        using (var hmac = new HMACSHA256(GetSigningKeyBytes()))
        {
            expectedSigBytes = hmac.ComputeHash(Encoding.ASCII.GetBytes(payloadB64));
        }

        byte[] providedSigBytes;
        try
        {
            providedSigBytes = Base64UrlDecode(sigB64);
        }
        catch
        {
            return null;
        }

        if (!CryptographicOperations.FixedTimeEquals(expectedSigBytes, providedSigBytes))
        {
            return null;
        }

        TokenPayload? payload;
        try
        {
            var payloadBytes = Base64UrlDecode(payloadB64);
            payload = JsonSerializer.Deserialize<TokenPayload>(payloadBytes);
        }
        catch
        {
            return null;
        }

        if (payload is null)
        {
            return null;
        }

        var nowUnix = DateTimeOffset.UtcNow.ToUnixTimeSeconds();
        if (payload.ExpiresAtUnixSeconds <= nowUnix)
        {
            return null;
        }

        if (_revokedTokens.ContainsKey(payload.Jti))
        {
            return null;
        }

        return payload;
    }

    public void RevokeToken(string rawToken)
    {
        var payload = ValidateToken(rawToken);
        if (payload is not null)
        {
            _revokedTokens[payload.Jti] = payload.ExpiresAtUnixSeconds;
        }
    }

    private static string Base64UrlEncode(byte[] input)
    {
        return Convert.ToBase64String(input)
            .TrimEnd('=')
            .Replace('+', '-')
            .Replace('/', '_');
    }

    private static byte[] Base64UrlDecode(string input)
    {
        var padded = input.Replace('-', '+').Replace('_', '/');
        switch (padded.Length % 4)
        {
            case 2:
                padded += "==";
                break;
            case 3:
                padded += "=";
                break;
        }
        return Convert.FromBase64String(padded);
    }
}

public sealed class FlowPilotBearerAuthenticationHandler(
    IOptionsMonitor<AuthenticationSchemeOptions> options,
    ILoggerFactory logger,
    UrlEncoder encoder,
    FlowPilotTokenService tokenService)
    : AuthenticationHandler<AuthenticationSchemeOptions>(options, logger, encoder)
{
    protected override Task<AuthenticateResult> HandleAuthenticateAsync()
    {
        var authHeader = Request.Headers.Authorization.FirstOrDefault();
        if (string.IsNullOrWhiteSpace(authHeader) ||
            !authHeader.StartsWith("Bearer ", StringComparison.OrdinalIgnoreCase))
        {
            return Task.FromResult(AuthenticateResult.NoResult());
        }

        var rawToken = authHeader["Bearer ".Length..].Trim();
        var payload = tokenService.ValidateToken(rawToken);
        if (payload is null)
        {
            return Task.FromResult(AuthenticateResult.Fail("Invalid, expired, or revoked Bearer token."));
        }

        var claims = new[]
        {
            new Claim(ClaimTypes.NameIdentifier, payload.UserId),
            new Claim(ClaimTypes.Email, payload.Email),
            new Claim(ClaimTypes.Name, payload.DisplayName),
            new Claim("jti", payload.Jti),
            new Claim("raw_token", rawToken),
        };

        var identity = new ClaimsIdentity(claims, FlowPilotTokenService.SchemeName);
        var principal = new ClaimsPrincipal(identity);
        var ticket = new AuthenticationTicket(principal, FlowPilotTokenService.SchemeName);

        return Task.FromResult(AuthenticateResult.Success(ticket));
    }
}
