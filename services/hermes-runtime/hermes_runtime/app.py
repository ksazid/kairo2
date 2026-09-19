from __future__ import annotations

from contextlib import asynccontextmanager
import logging

from fastapi import FastAPI, Header, HTTPException, Request

from .config import ConfigurationError, RuntimeConfig
from .core import HermesRuntimeError, ProviderError, RuntimeService
from .diagnostics import run_provider_diagnostic
from .upstream import HermesAgentExecutor, HermesSecurityError


logger = logging.getLogger("kairo.hermes.runtime")
logger.setLevel(logging.INFO)


@asynccontextmanager
async def lifespan(app: FastAPI):
    try:
        config = RuntimeConfig.from_env()
        executor = HermesAgentExecutor()
    except (ConfigurationError, HermesSecurityError) as error:
        # Failing lifespan prevents the service from becoming ready. Never
        # include environment values or provider exception bodies in logs.
        raise RuntimeError(f"Hermes runtime startup rejected: {type(error).__name__}") from error
    runtime = RuntimeService(config, executor)
    app.state.runtime_service = runtime
    app.state.runtime_version = config.runtime_version
    logger.info(
        "KAIRO_HERMES_RUNTIME_READY primary_provider=%s primary_model=%s primary_pricing=%s fallback_provider=%s fallback_model=%s fallback_pricing=%s",
        config.primary.provider,
        config.primary.model,
        config.primary.pricing_version,
        config.fallback.provider,
        config.fallback.model,
        config.fallback.pricing_version,
    )
    run_provider_diagnostic(runtime, config)
    yield


app = FastAPI(title="Kairo Hermes Runtime", version="1", lifespan=lifespan)


@app.get("/health/live")
def live() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/ready")
def ready(request: Request) -> dict[str, str]:
    runtime_version = getattr(request.app.state, "runtime_version", None)
    if not runtime_version:
        raise HTTPException(status_code=503, detail="Hermes runtime is not ready")
    return {"status": "ready", "runtimeVersion": runtime_version}


@app.post("/kairo/v1/invoke")
def invoke(
    payload: dict[str, object],
    request: Request,
    authorization: str | None = Header(default=None),
) -> dict[str, object]:
    runtime: RuntimeService = request.app.state.runtime_service
    try:
        return runtime.invoke(payload, authorization=authorization)
    except HermesRuntimeError as error:
        logger.warning(
            "KAIRO_HERMES_RUNTIME_ERROR status=%s detail=%s",
            error.status_code,
            str(error),
        )
        raise HTTPException(status_code=error.status_code, detail=str(error)) from error
    except ProviderError as error:
        # ProviderError messages are constructed by the Kairo-owned adapter and
        # contain only provider name, HTTP status (when known) and exception
        # class. Never log the provider exception body, request, prompt or key.
        logger.warning(
            "KAIRO_HERMES_PROVIDER_ERROR fallback_eligible=%s error=%s",
            error.fallback_eligible,
            str(error),
        )
        raise HTTPException(status_code=502, detail="Hermes model provider is unavailable") from error
    except HermesSecurityError as error:
        logger.error("KAIRO_HERMES_SECURITY_ERROR type=%s", type(error).__name__)
        raise HTTPException(status_code=503, detail="Hermes zero-tool security invariant failed") from error
