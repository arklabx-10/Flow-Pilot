using System.Text.RegularExpressions;

namespace FlowPilot.Api.Services;

public static partial class CloudTextRefiner
{
    public const string ProviderIdentifier = "flowpilot-cloud-refiner";

    public static string Refine(string originalTranscript, string outputMode)
    {
        var verbatim = originalTranscript ?? string.Empty;
        if (string.Equals(outputMode, "raw", StringComparison.OrdinalIgnoreCase))
        {
            return verbatim;
        }

        var cleaned = CleanSentence(verbatim);

        return outputMode.ToLowerInvariant() switch
        {
            "clean" => cleaned,
            "professional" => $"Hi team,\n\n{cleaned}\n\nBest regards,",
            "coding-prompt" => string.Join(
                "\n",
                "## Task",
                cleaned,
                "",
                "## Requirements",
                "- Preserve existing module boundaries and strict TypeScript types.",
                "- Add or update automated unit tests covering the change."),
            "quick-note" => string.Join(
                "\n",
                SentenceSplitRegex()
                    .Split(cleaned)
                    .Select(s => s.Trim())
                    .Where(s => s.Length > 0)
                    .Select(s => $"- {s}")),
            _ => cleaned,
        };
    }

    private static string CleanSentence(string input)
    {
        var withoutFillers = FillerWordsRegex().Replace(input, " ");
        var collapsed = WhitespaceRegex().Replace(withoutFillers, " ").Trim();
        if (collapsed.Length == 0)
        {
            return input.Trim();
        }

        var capitalized = char.ToUpperInvariant(collapsed[0]) + collapsed[1..];
        if (capitalized.EndsWith('.') || capitalized.EndsWith('!') || capitalized.EndsWith('?'))
        {
            return capitalized;
        }

        return $"{capitalized}.";
    }

    [GeneratedRegex(@"\b(um+|uh+|erm+|er+|hmm+)\b[,\s]*", RegexOptions.IgnoreCase)]
    private static partial Regex FillerWordsRegex();

    [GeneratedRegex(@"\s+")]
    private static partial Regex WhitespaceRegex();

    [GeneratedRegex(@"(?<=[.!?])\s+")]
    private static partial Regex SentenceSplitRegex();
}
