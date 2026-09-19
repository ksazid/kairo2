import os
import sys
import types
from pathlib import Path

import pytest

from hermes_runtime.config import ProviderConfig
from hermes_runtime.upstream import HermesAgentExecutor, HermesSecurityError, assert_zero_tool_profile


def provider(name="groq"):
    if name == "openrouter":
        return ProviderConfig(
            provider="openrouter",
            base_url="https://openrouter.ai/api/v1",
            model="openai/gpt-oss-120b:free",
            api_key="provider-secret",
            input_usd_per_million_tokens=0,
            output_usd_per_million_tokens=0,
            pricing_version="openrouter-free-test",
        )
    return ProviderConfig(
        provider="groq",
        base_url="https://api.groq.com/openai/v1",
        model="openai/gpt-oss-120b",
        api_key="provider-secret",
        input_usd_per_million_tokens=0,
        output_usd_per_million_tokens=0,
        pricing_version="groq-free-test",
    )


def install_model_tools(monkeypatch, tools):
    module = types.ModuleType("model_tools")
    module.get_tool_definitions = lambda **_kwargs: list(tools)
    monkeypatch.setitem(sys.modules, "model_tools", module)


def install_fake_agent(monkeypatch, captured):
    class FakeAgent:
        def __init__(self, **kwargs):
            captured.update(kwargs)
            self.tools = []
            self.valid_tool_names = set()
            self._memory_store = None
            self._memory_manager = None
            self.model = kwargs["model"]
            self.session_input_tokens = 321
            self.session_output_tokens = 123
            self._persist_disabled = False

        def run_conversation(self, *, user_message, task_id):
            captured["user_message"] = user_message
            captured["task_id"] = task_id
            captured["persist_disabled_at_run"] = self._persist_disabled
            return {"final_response": '{"ok":true}'}

        def close(self):
            captured["closed"] = True

    run_agent = types.ModuleType("run_agent")
    run_agent.AIAgent = FakeAgent
    monkeypatch.setitem(sys.modules, "run_agent", run_agent)


def test_startup_guard_accepts_only_an_exact_empty_tool_surface(monkeypatch):
    install_model_tools(monkeypatch, [])
    assert_zero_tool_profile()

    install_model_tools(monkeypatch, [{"type": "function", "function": {"name": "terminal"}}])
    with pytest.raises(HermesSecurityError, match="zero-tool"):
        assert_zero_tool_profile()


def test_executor_forces_isolated_hermes_home_and_disables_project_plugin_opt_in(monkeypatch):
    install_model_tools(monkeypatch, [])
    monkeypatch.setenv("HERMES_HOME", "/tmp/ambient-hermes")
    monkeypatch.setenv("HERMES_ENABLE_PROJECT_PLUGINS", "1")
    monkeypatch.setenv("HERMES_KANBAN_TASK", "ambient-task")
    monkeypatch.setenv("HERMES_PROFILE", "ambient-profile")

    HermesAgentExecutor()

    assert os.environ["HERMES_HOME"] == "/tmp/kairo-hermes"
    assert "HERMES_ENABLE_PROJECT_PLUGINS" not in os.environ
    assert "HERMES_KANBAN_TASK" not in os.environ
    assert "HERMES_PROFILE" not in os.environ


def test_executor_instantiates_one_memoryless_tooled_off_hermes_turn(monkeypatch):
    install_model_tools(monkeypatch, [])
    captured = {}
    install_fake_agent(monkeypatch, captured)

    result = HermesAgentExecutor().execute(
        provider(),
        system_prompt="system",
        user_prompt='{"instruction":"bounded"}',
        max_output_tokens=900,
        timeout_ms=5000,
    )

    assert captured["provider"] == "groq"
    assert captured["base_url"] == "https://api.groq.com/openai/v1"
    assert captured["api_key"] == "provider-secret"
    assert captured["model"] == "openai/gpt-oss-120b"
    assert captured["api_mode"] == "chat_completions"
    assert captured["max_iterations"] == 1
    assert captured["enabled_toolsets"] == []
    assert captured["save_trajectories"] is False
    assert captured["quiet_mode"] is True
    assert captured["skip_context_files"] is True
    assert captured["skip_memory"] is True
    assert captured["checkpoints_enabled"] is False
    assert captured["request_overrides"] == {
        "timeout": 5.0,
    }
    assert captured["persist_disabled_at_run"] is True
    assert captured["closed"] is True
    assert result.output_text == '{"ok":true}'
    assert result.input_tokens == 321
    assert result.output_tokens == 123


def test_openrouter_fallback_enforces_zdr_no_collection_and_parameter_support(monkeypatch):
    install_model_tools(monkeypatch, [])
    captured = {}
    install_fake_agent(monkeypatch, captured)

    HermesAgentExecutor().execute(
        provider("openrouter"),
        system_prompt="system",
        user_prompt="{}",
        max_output_tokens=100,
        timeout_ms=1000,
    )

    assert captured["request_overrides"] == {
        "timeout": 1.0,
        "response_format": {"type": "json_object"},
        "extra_body": {
            "provider": {
                "zdr": True,
                "data_collection": "deny",
                "require_parameters": True,
            }
        },
    }


def test_executor_disables_upstream_persistent_file_logging(monkeypatch):
    install_model_tools(monkeypatch, [])
    state = {"reset": 0}
    module = types.ModuleType("hermes_logging")

    def reset():
        state["reset"] += 1

    module._reset_queued_handlers = reset
    module.rotating_file_handlers = lambda: []
    module.setup_logging = lambda **_kwargs: Path("/should/not/be/used")
    module.setup_verbose_logging = lambda: None
    monkeypatch.setitem(sys.modules, "hermes_logging", module)

    HermesAgentExecutor()

    assert state["reset"] == 1
    assert module.setup_logging(hermes_home=Path("/tmp/kairo-test")) == Path("/tmp/kairo-test/logs")


def test_executor_rejects_tools_or_memory_even_if_upstream_resolver_regresses(monkeypatch):
    install_model_tools(monkeypatch, [])

    class ToolAgent:
        def __init__(self, **_kwargs):
            self.tools = [{"type": "function", "function": {"name": "terminal"}}]
            self.valid_tool_names = {"terminal"}
            self._memory_store = None
            self._memory_manager = None

        def close(self):
            pass

    run_agent = types.ModuleType("run_agent")
    run_agent.AIAgent = ToolAgent
    monkeypatch.setitem(sys.modules, "run_agent", run_agent)

    with pytest.raises(HermesSecurityError, match="tool surface"):
        HermesAgentExecutor().execute(
            provider(),
            system_prompt="system",
            user_prompt="{}",
            max_output_tokens=100,
            timeout_ms=1000,
        )
