import json

import pytest

from hermes_runtime.config import ProviderConfig, RuntimeConfig
from hermes_runtime.core import (
    HERMES_POLICY_FINGERPRINT,
    HermesRuntimeError,
    ProviderError,
    ProviderResult,
    RuntimeService,
)


class FakeExecutor:
    def __init__(self, outcomes):
        self.outcomes = list(outcomes)
        self.calls = []

    def execute(self, provider, *, system_prompt, user_prompt, max_output_tokens, timeout_ms):
        self.calls.append({
            "provider": provider,
            "system_prompt": system_prompt,
            "user_prompt": user_prompt,
            "max_output_tokens": max_output_tokens,
            "timeout_ms": timeout_ms,
        })
        outcome = self.outcomes.pop(0)
        if isinstance(outcome, Exception):
            raise outcome
        return outcome


def provider(name, key, *, input_rate=1.0, output_rate=2.0, pricing_version=None):
    return ProviderConfig(
        provider=name,
        base_url=f"https://{name}.example.test/v1",
        model=f"{name}-model",
        api_key=key,
        input_usd_per_million_tokens=input_rate,
        output_usd_per_million_tokens=output_rate,
        pricing_version=pricing_version or f"{name}-pricing-v1",
    )


def config():
    return RuntimeConfig(
        service_token="service-secret",
        primary=provider("groq", "groq-secret"),
        fallback=provider("openrouter", "openrouter-secret", input_rate=3.0, output_rate=4.0),
        runtime_version="hermes-agent@9de9c25f620ff7f1ce0fd5457d596052d5159596",
    )


def request(*, routing_mode="resilient", fingerprint=HERMES_POLICY_FINGERPRINT, enabled_tools=None, max_cost_usd=0.05):
    return {
        "role": "strategist",
        "scope": {"visibility": "brand-private", "workspaceId": "workspace-1", "brandId": "brand-1"},
        "approvedContextVersion": "brand-1@2",
        "task": {"instruction": "Return a bounded answer.", "context": {"claims": [{"id": "claim-1", "text": "Verified"}]}},
        "outputSchema": {"name": "strategist-angles", "version": "1"},
        "budget": {"maxOutputTokens": 800, "maxCostUsd": max_cost_usd, "timeoutMs": 5000},
        "enabledTools": [] if enabled_tools is None else enabled_tools,
        "policyFingerprint": fingerprint,
        "routingMode": routing_mode,
    }


def success(*, model="groq-model", input_tokens=1000, output_tokens=500):
    return ProviderResult(
        output_text=json.dumps({"accepted": True}),
        model=model,
        input_tokens=input_tokens,
        output_tokens=output_tokens,
    )


def service(executor):
    return RuntimeService(config(), executor)


def test_rejects_missing_or_wrong_bearer_token_before_provider_execution():
    executor = FakeExecutor([success()])
    runtime = service(executor)

    with pytest.raises(HermesRuntimeError, match="unauthorized") as missing:
        runtime.invoke(request(), authorization=None)
    assert missing.value.status_code == 401

    with pytest.raises(HermesRuntimeError, match="unauthorized") as wrong:
        runtime.invoke(request(), authorization="Bearer wrong")
    assert wrong.value.status_code == 401
    assert executor.calls == []


def test_rejects_policy_or_tool_authority_before_provider_execution():
    executor = FakeExecutor([success()])
    runtime = service(executor)

    with pytest.raises(HermesRuntimeError, match="fingerprint"):
        runtime.invoke(request(fingerprint="wrong"), authorization="Bearer service-secret")
    with pytest.raises(HermesRuntimeError, match="zero-tool"):
        runtime.invoke(request(enabled_tools=["terminal"]), authorization="Bearer service-secret")

    assert executor.calls == []


def test_uses_groq_primary_and_returns_auditable_cost_metadata_without_leaking_secrets():
    executor = FakeExecutor([success(input_tokens=1000, output_tokens=500)])
    runtime = service(executor)

    response = runtime.invoke(request(), authorization="Bearer service-secret")

    assert len(executor.calls) == 1
    call = executor.calls[0]
    assert call["provider"].provider == "groq"
    serialized_prompt = call["system_prompt"] + call["user_prompt"]
    assert "service-secret" not in serialized_prompt
    assert "groq-secret" not in serialized_prompt
    assert "openrouter-secret" not in serialized_prompt
    assert response["output"] == {"accepted": True}
    assert response["policy"] == {
        "fingerprint": HERMES_POLICY_FINGERPRINT,
        "enabledTools": [],
        "runtimeVersion": "hermes-agent@9de9c25f620ff7f1ce0fd5457d596052d5159596",
    }
    assert response["metadata"] == {
        "provider": "groq",
        "model": "groq-model",
        "inputTokens": 1000,
        "outputTokens": 500,
        "costUsd": pytest.approx(0.002),
        "pricingVersion": "groq-pricing-v1",
        "latencyMs": pytest.approx(response["metadata"]["latencyMs"]),
    }
    assert response["metadata"]["latencyMs"] >= 0


def test_resilient_mode_falls_back_to_openrouter_only_for_eligible_primary_failure():
    executor = FakeExecutor([
        ProviderError("primary capacity", fallback_eligible=True),
        success(model="openrouter-model", input_tokens=1000, output_tokens=500),
    ])
    runtime = service(executor)

    response = runtime.invoke(request(routing_mode="resilient"), authorization="Bearer service-secret")

    assert [call["provider"].provider for call in executor.calls] == ["groq", "openrouter"]
    assert response["metadata"]["provider"] == "openrouter"
    assert response["metadata"]["model"] == "openrouter-model"
    assert response["metadata"]["costUsd"] == pytest.approx(0.005)
    assert response["metadata"]["pricingVersion"] == "openrouter-pricing-v1"


def test_primary_only_mode_never_falls_back_for_controlled_benchmark():
    executor = FakeExecutor([
        ProviderError("primary capacity", fallback_eligible=True),
        success(model="should-never-run"),
    ])
    runtime = service(executor)

    with pytest.raises(ProviderError, match="primary capacity"):
        runtime.invoke(request(routing_mode="primary-only"), authorization="Bearer service-secret")

    assert [call["provider"].provider for call in executor.calls] == ["groq"]


def test_resilient_mode_does_not_fallback_for_noneligible_provider_failure():
    executor = FakeExecutor([
        ProviderError("invalid request", fallback_eligible=False),
        success(model="should-never-run"),
    ])
    runtime = service(executor)

    with pytest.raises(ProviderError, match="invalid request"):
        runtime.invoke(request(), authorization="Bearer service-secret")

    assert [call["provider"].provider for call in executor.calls] == ["groq"]


def test_rejects_unsupported_routing_mode_before_provider_execution():
    executor = FakeExecutor([success()])
    runtime = service(executor)

    with pytest.raises(HermesRuntimeError, match="routing mode"):
        runtime.invoke(request(routing_mode="unbounded"), authorization="Bearer service-secret")

    assert executor.calls == []


def test_rejects_non_json_object_output_and_missing_usage():
    invalid_json = FakeExecutor([ProviderResult(output_text="not-json", model="m", input_tokens=1, output_tokens=1)])
    with pytest.raises(HermesRuntimeError, match="JSON object"):
        service(invalid_json).invoke(request(), authorization="Bearer service-secret")

    missing_usage = FakeExecutor([ProviderResult(output_text='{"ok":true}', model="m", input_tokens=None, output_tokens=1)])
    with pytest.raises(HermesRuntimeError, match="token usage"):
        service(missing_usage).invoke(request(), authorization="Bearer service-secret")


def test_fails_when_measured_cost_exceeds_kairo_budget():
    executor = FakeExecutor([success(input_tokens=1_000_000, output_tokens=1_000_000)])
    runtime = service(executor)

    with pytest.raises(HermesRuntimeError, match="cost budget"):
        runtime.invoke(request(max_cost_usd=0.001), authorization="Bearer service-secret")
