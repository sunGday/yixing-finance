"""yixing-finance API. Run: FIN_API_TOKEN=... uvicorn main:app --host 0.0.0.0 --port 8787"""
from __future__ import annotations
import hmac, os, sys
sys.path.insert(0, os.path.dirname(os.path.abspath(__file__)))
from fastapi import FastAPI, Request
from fastapi.exceptions import RequestValidationError
from fastapi.middleware.cors import CORSMiddleware
from fastapi.responses import JSONResponse
from adapters import CredentialMissingError
from api.routes import router, ApiError, rid, VERSION
import store as st
from credentials_store import CredentialStore


def create_app(recharge_store: st.RechargeStore | None = None, cost_store=None, snapshot_store=None,
               credential_store: CredentialStore | None = None, *, settlement_store=None, gromore_client=None,
               overview_today=None, pangle_live_items=None) -> FastAPI:
    app = FastAPI(title="yixing-finance", version=VERSION)
    app.state.recharges = recharge_store if recharge_store is not None else st.RechargeStore.from_cache()
    app.state.costs = cost_store if cost_store is not None else st.CostStore.from_disk()
    app.state.snapshots = snapshot_store if snapshot_store is not None else st.SnapshotStore.from_disk()
    app.state.settlements = settlement_store if settlement_store is not None else st.SettlementStore()
    app.state.gromore_client = gromore_client
    app.state.overview_today = overview_today
    app.state.pangle_live_items = pangle_live_items
    # 收入渠道凭证：FIN_SECRETS_DIR 文件 → 合并进 os.environ（进程 env 优先），适配器直接读
    app.state.credentials = credential_store if credential_store is not None else CredentialStore()
    origins = [o for o in os.environ.get("FIN_CORS_ORIGINS", "*").split(",") if o]
    app.add_middleware(CORSMiddleware, allow_origins=origins, allow_methods=["GET", "POST", "PUT", "PATCH", "DELETE", "OPTIONS"],
                       allow_headers=["*"], expose_headers=["X-Auth-Mode"])

    @app.middleware("http")
    async def auth(request: Request, call_next):
        tok = os.environ.get("FIN_API_TOKEN")
        if request.method == "OPTIONS" or not request.url.path.startswith("/api/"):
            return await call_next(request)
        if not tok:
            host = request.client.host if request.client else ""
            public = os.environ.get("FIN_REQUIRE_TOKEN") == "1" or host not in ("127.0.0.1", "::1", "localhost", "testclient") \
                or any(ip.strip() not in ("127.0.0.1", "::1", "::ffff:127.0.0.1", "")
                       for ip in request.headers.get("x-forwarded-for", "").split(","))
            if public:  # 公网/代理入口禁止 open-dev
                return JSONResponse({"code": 50302, "msg": "FIN_API_TOKEN not set; open-dev only on localhost", "request_id": rid(), "data": None}, 503)
            resp = await call_next(request); resp.headers["X-Auth-Mode"] = "open-dev"; return resp
        h = request.headers.get("authorization", "")
        if not (h.startswith("Bearer ") and hmac.compare_digest(h[7:], tok)):
            return JSONResponse({"code": 40101, "msg": "unauthorized", "request_id": rid(), "data": None}, 401)
        resp = await call_next(request); resp.headers["X-Auth-Mode"] = "token"; return resp

    @app.exception_handler(ApiError)
    async def api_err(_, e: ApiError):
        return JSONResponse({"code": e.code, "msg": e.msg, "request_id": rid(), "data": e.data}, e.http)

    @app.exception_handler(CredentialMissingError)
    async def cred_err(_, e):
        return JSONResponse({"code": 50301, "msg": f"CredentialMissingError: {e}", "request_id": rid(), "data": None}, 503)

    @app.exception_handler(RequestValidationError)
    async def val_err(_, e):
        return JSONResponse({"code": 40001, "msg": "invalid params", "request_id": rid(), "data": {"errors": str(e.errors())[:500]}}, 400)

    app.include_router(router)
    return app


app = create_app()

if __name__ == "__main__":
    import uvicorn
    uvicorn.run(app, host=os.environ.get("HOST", "0.0.0.0"), port=int(os.environ.get("PORT", "8787")))
