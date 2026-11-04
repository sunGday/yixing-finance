"""Revenue adapters (REQ-20261104-10C v0.2 skeleton). Importing registers pangle + ylh(gdt alias)."""
from .base import RevenueRow, RevenueAdapter, register, get_adapter, list_adapters, CredentialMissingError, yuan_to_fen  # noqa
from . import pangle, ylh  # noqa: F401  (registration side effect)
