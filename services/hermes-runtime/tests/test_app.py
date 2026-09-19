from types import SimpleNamespace

from hermes_runtime.core import ProviderError
from hermes_runtime.diagnostics import provider_diagnostic_payload, run_provider_diagnostic


class FakeRuntime:
    def __init__(self, result=None, error=None):
        self.result = result
        self.error = error
        self.calls = []

    def invoke(self, payload, *, authorization):
        self.calls.append((payload, authorization))
        if self.error is not None:
            raise self.error
        return self.result


def test_provider_diagnostic_is_default_off():
    runtime = FakeRuntime(result={"metadata": {}})
    config = SimpleNamespace(service_token="service-secret")

    run_provider_diagnostic(runtime, config, {})

    assert runtime.calls == []


def test_provider_diagnostic_uses_synthetic_zero_tool_payload_and_logs_only_safe_metadata(caplog):
    runtime = FakeRuntime(
        result={
            "output": {"ok": True, "secret": "must-not-appear"},
            "metadata": {
                "provider": "groq",
                "model": "openai/gpt-oss-120b",
                "pricingVersion": "groq-free-2026-08-16",
                "latencyMs": 123,
                "costUsd": 0.0,
            },
        }
    )
    config = SimpleNamespace(service_token="service-secret")

    with caplog.at_level("WARNING", logger="kairo.hermes.runtime"):
        run_provider_diagnostic(
            runtime,
            config,
            {"KAIRO_HERMES_PROVIDER_DIAGNOSTIC_RUN": "1"},
        )

    assert len(runtime.calls) == 1
    payload, authorization = runtime.calls[0]
    assert authorization == "Bearer service-secret"
    assert payload == provider_diagnostic_payload()
    assert payload["enabledTools"] == []
    assert payload["scope"] == {"visibility": "global-public"}
    assert "KAIRO_HERMES_PROVIDER_DIAGNOSTIC_OK" in caplog.text
    assert "groq" in caplog.text
    assert "service-secret" not in caplog.text
    assert "must-not-appear" not in caplog.text


def test_provider_diagnostic_logs_sanitized_provider_failure_only(caplog):
    runtime = FakeRuntime(
        error=ProviderError(
            "groq model invocation failed status=400 (BadRequestError)",
            fallback_eligible=False,
        )
    )
    config = SimpleNamespace(service_token="service-secret")

    with caplog.at_level("WARNING", logger="kairo.hermes.runtime"):
        run_provider_diagnostic(
            runtime,
            config,
            {"KAIRO_HERMES_PROVIDER_DIAGNOSTIC_RUN": "1"},
        )

    assert "KAIRO_HERMES_PROVIDER_DIAGNOSTIC_FAILED kind=provider" in caplog.text
    assert "status=400" in caplog.text
    assert "service-secret" not in caplog.text
