import pytest

from hermes_runtime.config import ConfigurationError, RuntimeConfig


def env():
    return {
        "KAIRO_HERMES_SERVICE_TOKEN": "service-secret",
        "HERMES_PRIMARY_PROVIDER": "groq",
        "HERMES_PRIMARY_BASE_URL": "https://api.groq.com/openai/v1",
        "HERMES_PRIMARY_MODEL": "openai/gpt-oss-120b",
        "GROQ_API_KEY": "groq-secret",
        "HERMES_PRIMARY_INPUT_USD_PER_1M_TOKENS": "0",
        "HERMES_PRIMARY_OUTPUT_USD_PER_1M_TOKENS": "0",
        "HERMES_PRIMARY_PRICING_VERSION": "groq-free-2026-08-16",
        "HERMES_FALLBACK_PROVIDER": "openrouter",
        "HERMES_FALLBACK_BASE_URL": "https://openrouter.ai/api/v1",
        "HERMES_FALLBACK_MODEL": "openai/gpt-oss-120b:free",
        "OPENROUTER_API_KEY": "openrouter-secret",
        "HERMES_FALLBACK_INPUT_USD_PER_1M_TOKENS": "0",
        "HERMES_FALLBACK_OUTPUT_USD_PER_1M_TOKENS": "0",
        "HERMES_FALLBACK_PRICING_VERSION": "openrouter-free-2026-08-16",
    }


def test_reads_provider_keys_only_inside_hermes_configuration():
    config = RuntimeConfig.from_env(env())
    assert config.primary.provider == "groq"
    assert config.primary.api_key == "groq-secret"
    assert config.fallback.provider == "openrouter"
    assert config.fallback.api_key == "openrouter-secret"
    assert config.runtime_version.endswith("9de9c25f620ff7f1ce0fd5457d596052d5159596")


def test_fails_closed_for_missing_secret_pricing_or_non_https_provider_url():
    missing = env()
    missing.pop("GROQ_API_KEY")
    with pytest.raises(ConfigurationError, match="GROQ_API_KEY"):
        RuntimeConfig.from_env(missing)

    pricing = env()
    pricing["HERMES_PRIMARY_INPUT_USD_PER_1M_TOKENS"] = "not-a-rate"
    with pytest.raises(ConfigurationError, match="non-negative"):
        RuntimeConfig.from_env(pricing)

    insecure = env()
    insecure["HERMES_PRIMARY_BASE_URL"] = "http://api.groq.com/openai/v1"
    with pytest.raises(ConfigurationError, match="HTTPS"):
        RuntimeConfig.from_env(insecure)
