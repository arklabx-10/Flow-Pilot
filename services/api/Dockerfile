FROM mcr.microsoft.com/dotnet/sdk:10.0 AS build
WORKDIR /src

COPY global.json FlowPilot.slnx ./
COPY services/api/src/FlowPilot.Api/FlowPilot.Api.csproj services/api/src/FlowPilot.Api/
COPY services/api/tests/FlowPilot.Api.Tests/FlowPilot.Api.Tests.csproj services/api/tests/FlowPilot.Api.Tests/
RUN dotnet restore services/api/src/FlowPilot.Api/FlowPilot.Api.csproj

COPY services/api/src/FlowPilot.Api/ services/api/src/FlowPilot.Api/
RUN dotnet publish services/api/src/FlowPilot.Api/FlowPilot.Api.csproj -c Release -o /app/publish /p:UseAppHost=false

FROM mcr.microsoft.com/dotnet/aspnet:10.0 AS runtime
WORKDIR /app
EXPOSE 5080
ENV ASPNETCORE_URLS=http://+:5080
ENV ASPNETCORE_ENVIRONMENT=Production

COPY --from=build /app/publish .
ENTRYPOINT ["dotnet", "FlowPilot.Api.dll"]
