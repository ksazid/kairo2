from __future__ import annotations

from dataclasses import dataclass
from os import environ
from urllib.parse import urlparse


class ConfigurationError(RuntimeError):
    pass


@dataclass(frozen=True)
class ProviderConfig:
    provider: str
    base_url: str
    model: str
    api_key: str
    input_usd_per_million_tokens: float
    output_usd_per_million_tokens: float
    pricing_version: str

    def __post_init__(self) -> None:
        provider = _required(self.provider, "provider").lower()
        model = _required(self.model, "model")
        api_key = _required(self.api_key, "api_key")
        pricing_version = _required(self.pricing_version, "pricing_version")
        base_url = _https_url(self.base_url, "base_url")
        input_rate = _rate(self.input_usd_per_million_tokens, "input token rate")
        output_rate = _rate(self.output_usd_per_million_tokens, "output token rate")
        object.__setattr__(self, "provider", provider)
        object.__setattr__(self, "model", model)
        object.__setattr__(self, "api_key", api_key)
        object.__setattr__(self, "pricing_version", pricing_version)
        object.__setattr__(self, "base_url", base_url)
        object.__setattr__(self, "input_usd_per_million_tokens", input_rate)
        object.__setattr__(self, "output_usd_per_million_tokens", output_rate)


@dataclass(frozen=True)
class RuntimeConfig:
    service_token: str
    primary: ProviderConfig
    fallback: ProviderConfig
    runtime_version: str

    def __post_init__(self) -> None:
        object.__setattr__(self, "service_token", _required(self.service_token, "service token"))
        object.__setattr__(self, "runtime_version", _required(self.runtime_version, "runtime version"))
        if self.primary.provider == self.fallback.provider and self.primary.model == self.fallback.model and self.primary.base_url == self.fallback.base_url:
            raise ConfigurationError("primary and fallback routes must be distinct")

    @classmethod
    def from_env(cls, env: dict[str, str] | None = None) -> "RuntimeConfig":
        values = env if env is not None else environ
        return cls(
            service_token=_env(values, "KAIRO_HERMES_SERVICE_TOKEN"),
            primary=_provider_from_env(values, "PRIMARY", "GROQ_API_KEY"),
            fallback=_provider_from_env(values, "FALLBACK", "OPENROUTER_API_KEY"),
            runtime_version="hermes-agent@9de9c25f620ff7f1ce0fd5457d596052d5159596",
        )


def _provider_from_env(values: dict[str, str], prefix: str, key_name: str) -> ProviderConfig:
    return ProviderConfig(
        provider=_env(values, f"HERMES_{prefix}_PROVIDER"),
        base_url=_env(values, f"HERMES_{prefix}_BASE_URL"),
        model=_env(values, f"HERMES_{prefix}_MODEL"),
        api_key=_env(values, key_name),
        input_usd_per_million_tokens=_number(values, f"HERMES_{prefix}_INPUT_USD_PER_1M_TOKENS"),
        output_usd_per_million_tokens=_number(values, f"HERMES_{prefix}_OUTPUT_USD_PER_1M_TOKENS"),
        pricing_version=_env(values, f"HERMES_{prefix}_PRICING_VERSION"),
    )


def _env(values: dict[str, str], name: str) -> str:
    value = values.get(name, "")
    if not isinstance(value, str) or not value.strip():
        raise ConfigurationError(f"{name} is required")
    return value.strip()


def _number(values: dict[str, str], name: str) -> float:
    raw = _env(values, name)
    try:
        parsed = float(raw)
    except ValueError as error:
        raise ConfigurationError(f"{name} must be a non-negative number") from error
    return _rate(parsed, name)


def _required(value: object, field: str) -> str:
    if not isinstance(value, str) or not value.strip():
        raise ConfigurationError(f"{field} is required")
    return value.strip()


def _rate(value: object, field: str) -> float:
    if not isinstance(value, (int, float)) or isinstance(value, bool):
        raise ConfigurationError(f"{field} must be a non-negative number")
    parsed = float(value)
    if parsed < 0 or parsed == float("inf") or parsed != parsed:
        raise ConfigurationError(f"{field} must be a non-negative number")
    return parsed


def _https_url(value: object, field: str) -> str:
    text = _required(value, field).rstrip("/")
    parsed = urlparse(text)
    if parsed.scheme != "https" or not parsed.netloc or parsed.username or parsed.password:
        raise ConfigurationError(f"{field} must be an HTTPS URL without embedded credentials")
    return text
