from __future__ import annotations

from ..memory import SimpleMemory
from ..vfs.interface import VFS
from .adapters import DemoSearchDocument

TODO_TEXT = "\n".join(
    (
        "1. Review refund incident timeline",
        "2. Confirm Acme renewal owner",
        "3. Draft follow-up email",
        "",
    )
)

APP_LOG_TEXT = "\n".join(
    (
        "2026-03-12T10:00:01Z INFO startup complete",
        "2026-03-12T10:01:10Z ERROR payment timeout order=123",
        "2026-03-12T10:01:11Z ERROR payment timeout order=124",
        "2026-03-12T10:01:12Z WARN retry scheduled order=124",
        "2026-03-12T10:02:10Z ERROR failed login user=alice",
        "2026-03-12T10:03:55Z INFO healthcheck ok",
        "",
    )
)

DEFAULT_CONFIG_TEXT = '{\n  "env": "default",\n  "retries": 3,\n  "region": "us-east-1"\n}\n'
PROD_CONFIG_TEXT = (
    '{\n'
    '  "env": "prod",\n'
    '  "retries": 5,\n'
    '  "region": "eu-west-1",\n'
    '  "owner": {\n'
    '    "email": "ops@example.com"\n'
    "  }\n"
    "}\n"
)

ACME_ACCOUNT_TEXT = "\n".join(
    (
        "Customer: Acme Corp",
        "Status: renewal at risk",
        "Owner: sara@example.com",
        "Notes: prefers Monday check-ins and a concise status summary.",
        "",
    )
)

QBR_DRAFT_TEXT = "# QBR draft\n\nOpen items:\n- Revenue variance\n- Renewal risk\n"
LOGO_PNG_BYTES = bytes([137, 80, 78, 71, 13, 10, 26, 10, 0, 1, 2, 3])

DEMO_FILES: dict[str, str | bytes] = {
    "/notes/todo.txt": TODO_TEXT,
    "/logs/app.log": APP_LOG_TEXT,
    "/config/default.json": DEFAULT_CONFIG_TEXT,
    "/config/prod.json": PROD_CONFIG_TEXT,
    "/accounts/acme.md": ACME_ACCOUNT_TEXT,
    "/drafts/qbr.md": QBR_DRAFT_TEXT,
    "/images/logo.png": LOGO_PNG_BYTES,
}

DEMO_SEARCH_DOCS = [
    DemoSearchDocument(
        title="Refund timeout incident retro",
        body=(
            "Payment timeouts spiked during a deploy. Root cause was a retry storm "
            "against the order service."
        ),
        source="kb://incidents/refund-timeout",
    ),
    DemoSearchDocument(
        title="Acme renewal risk notes",
        body="Acme wants a tighter weekly status update and is blocked on invoice mapping.",
        source="kb://accounts/acme-renewal",
    ),
    DemoSearchDocument(
        title="EU VAT invoice checklist",
        body=(
            "Collect legal entity name, billing address, VAT ID, and invoice delivery "
            "contact before issuing invoices."
        ),
        source="kb://finance/eu-vat-checklist",
    ),
    DemoSearchDocument(
        title="Login failure playbook",
        body="Repeated failed login errors can indicate bot traffic or a stale SSO configuration.",
        source="kb://security/login-failure-playbook",
    ),
]

DEMO_FETCH_RESOURCES: dict[str, object] = {
    "order:123": {
        "id": "123",
        "status": "timed_out",
        "customer": {
            "name": "Acme Corp",
            "email": "buyer@acme.example",
        },
        "amount": 1499,
    },
    "crm/customer/acme": {
        "id": "cust_acme",
        "owner": {
            "name": "Sara",
            "email": "sara@example.com",
        },
        "tier": "enterprise",
        "renewal_month": "2026-04",
    },
    "text:runbook": "Escalate payment timeouts to the checkout on-call if the error rate exceeds 2%.",
}

DEMO_MEMORY_ENTRIES = [
    "Acme prefers Monday follow-ups.",
    "Refund incident touched payments, billing, and checkout.",
    "Ops owner for production config is ops@example.com.",
]


async def seed_demo_vfs(vfs: VFS) -> None:
    for file_path, content in DEMO_FILES.items():
        data = content if isinstance(content, bytes) else content.encode("utf-8")
        await vfs.write_bytes(file_path, data)


def seed_demo_memory(memory: SimpleMemory) -> None:
    for entry in DEMO_MEMORY_ENTRIES:
        memory.store(entry)


def generate_large_log() -> str:
    lines: list[str] = []
    bob_timeout_lines = {60 + index * 10 for index in range(15)}

    for line_number in range(1, 301):
        second = str((line_number - 1) % 60).zfill(2)
        minute = str((line_number - 1) // 60).zfill(2)
        timestamp = f"2026-03-12T12:{minute}:{second}Z"

        if line_number in bob_timeout_lines:
            lines.append(
                f"{timestamp} ERROR timeout user=bob request=req-{line_number:04d}"
            )
            continue

        if line_number % 17 == 0:
            lines.append(
                f"{timestamp} WARN timeout user=carol request=req-{line_number:04d}"
            )
            continue

        lines.append(f"{timestamp} INFO heartbeat seq={line_number:04d}")

    lines.append("")
    return "\n".join(lines)
