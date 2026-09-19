from __future__ import annotations

import logging
import os

from .config import RuntimeConfig
from .core import HermesRuntimeError, ProviderError, RuntimeService
from .upstream import HermesSecurityError


logger = logging.getLogger("kairo.hermes.runtime")


def run_provider_diagnostic(
    runtime: RuntimeService,
    config: RuntimeConfig,
    env: dict[str, str] | None = None,
) -> None:
    values = env if env is not None else os.environ
    if values.get("KAIRO_HERMES_PROVIDER_DIAGNOSTIC_RUN", "").strip() != "1":
        return

    try:
        result = runtime.invoke(
            provider_diagnostic_payload(),
            authorization=f"Bearer {config.service_token}",
        )
    except HermesRuntimeError as error:
        logger.warning(
            "KAIRO_HERMES_PROVIDER_DIAGNOSTIC_FAILED kind=runtime status=%s detail=%s",
            error.status_code,
            str(error),
        )
    except ProviderError as error:
        logger.warning(
            "KAIRO_HERMES_PROVIDER_DIAGNOSTIC_FAILED kind=provider fallback_eligible=%s error=%s",
            error.fallback_eligible,
            str(error),
        )
    except HermesSecurityError as error:
        logger.error(
            "KAIRO_HERMES_PROVIDER_DIAGNOSTIC_FAILED kind=security type=%s",
            type(error).__name__,
        )
    else:
        metadata = result.get("metadata") if isinstance(result, dict) else None
        safe = metadata if isinstance(metadata, dict) else {}
        logger.warning(
            "KAIRO_HERMES_PROVIDER_DIAGNOSTIC_OK provider=%s model=%s pricing=%s latency_ms=%s cost_usd=%s",
            safe.get("provider", "unknown"),
            safe.get("model", "unknown"),
            safe.get("pricingVersion", "unknown"),
            safe.get("latencyMs", "unknown"),
            safe.get("costUsd", "unknown"),
        )


def provider_diagnostic_payload() -> dict[str, object]:
    return {
        "role": "judge",
        "scope": {"visibility": "global-public"},
        "approvedContextVersion": "hermes-provider-diagnostic-v1",
        "task": {
            "instruction": "Return exactly one JSON object with ok set to true.",
            "context": {"purpose": "provider-route-diagnostic"},
        },
        "outputSchema": {"name": "HermesProviderDiagnostic", "version": "1"},
        # Keep the synthetic verifier inside the exact execution ceiling used
        # by the four-case marketing qualification. The previous 32-token / 10s
        # diagnostic was materially tighter than the benchmark and caused the
        # model to hit finish_reason=length before Kairo could validate JSON.
        "budget": {
            "maxOutputTokens": 2200,
            "maxCostUsd": 0.03,
            "timeoutMs": 30000,
        },
        "enabledTools": [],
        "policyFingerprint": "kairo-hermes-reasoning-only-vs03:d2c6af3aa258c47d64c41a56fe9ff61815334e17",
        "routingMode": "resilient",
    }
