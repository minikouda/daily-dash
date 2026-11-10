"""MCP server (stdio) that routes Code mode's permission prompts to the dashboard.

`claude -p --permission-prompt-tool mcp__approve__permission_prompt` calls this
before any file edit or shell command. The request becomes a 'permission'
proposal in chat_proposals; the chat panel shows it with Approve / Deny, and
this call waits for the user's answer.
"""

import json
import os
import time

from mcp.server.mcpserver import MCPServer

from . import db
from .db import now_iso

server = MCPServer("approve")
WAIT_SECONDS = 15 * 60


def _summary(tool_name: str, tool_input: dict) -> str:
    if tool_name == "Bash":
        return f"Run: {tool_input.get('command', '')[:140]}"
    if tool_name in ("Edit", "Write", "MultiEdit", "NotebookEdit"):
        path = tool_input.get("file_path") or tool_input.get("notebook_path") or ""
        return f"{'Create/overwrite' if tool_name == 'Write' else 'Edit'} {path}"
    return f"Use {tool_name}"


READ_ONLY = {"Read": "file_path", "Glob": "path", "Grep": "path"}


def _read_inside_project(tool_name: str, tool_input: dict) -> bool:
    """Reads inside the project are approved without asking. Reads anywhere else
    (e.g. ~/.daily-dash with your Gmail tokens) go to the user like any write."""
    if tool_name not in READ_ONLY:
        return False
    project = os.path.realpath(os.environ["DD_PROJECT"])
    target = tool_input.get(READ_ONLY[tool_name]) or project  # Glob/Grep default to cwd
    target = os.path.realpath(os.path.join(project, os.path.expanduser(target)))
    return target == project or target.startswith(project + os.sep)


# Claude Code expects exactly one text block back, so no structured output.
@server.tool(structured_output=False)
def permission_prompt(tool_name: str, input: dict, tool_use_id: str | None = None) -> str:
    """Ask the dashboard user to approve a tool call. Returns the permission decision JSON."""
    if _read_inside_project(tool_name, input):
        return json.dumps({"behavior": "allow", "updatedInput": input})
    session = os.environ.get("DD_CHAT_SESSION", "")
    payload = {"tool": tool_name, "input": input}
    with db.session() as conn:
        pid = conn.execute(
            "INSERT INTO chat_proposals (session_id, action, payload, summary, status, created_at)"
            " VALUES (?, 'permission', ?, ?, 'pending', ?)",
            (session, json.dumps(payload, ensure_ascii=False), _summary(tool_name, input)[:160], now_iso()),
        ).lastrowid

    deadline = time.monotonic() + WAIT_SECONDS
    while time.monotonic() < deadline:
        with db.session() as conn:
            status = conn.execute("SELECT status FROM chat_proposals WHERE id = ?", (pid,)).fetchone()["status"]
        if status == "applied":
            return json.dumps({"behavior": "allow", "updatedInput": input})
        if status in ("rejected", "failed"):
            return json.dumps({"behavior": "deny", "message": "The user denied this. Ask what they'd like instead."})
        time.sleep(0.5)
    with db.session() as conn:
        conn.execute("UPDATE chat_proposals SET status = 'rejected', result = 'timed out' WHERE id = ?", (pid,))
    return json.dumps({"behavior": "deny", "message": "No answer from the user within 15 minutes."})


def main() -> None:
    server.run("stdio")


if __name__ == "__main__":
    main()
