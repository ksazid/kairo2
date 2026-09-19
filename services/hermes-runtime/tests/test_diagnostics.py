from hermes_runtime.diagnostics import provider_diagnostic_payload


def test_provider_diagnostic_uses_marketing_qualification_execution_ceiling():
    payload = provider_diagnostic_payload()

    assert payload["scope"] == {"visibility": "global-public"}
    assert payload["enabledTools"] == []
    assert payload["routingMode"] == "resilient"
    assert payload["budget"] == {
        "maxOutputTokens": 2200,
        "maxCostUsd": 0.03,
        "timeoutMs": 30000,
    }
