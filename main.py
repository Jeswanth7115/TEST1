import os
import httpx
from fastapi import FastAPI, Request, Response
from fastapi.middleware.cors import CORSMiddleware

app = FastAPI(
    title="Job Scheduler Uvicorn Proxy",
    description="Python FastAPI / Uvicorn server proxying requests to Node.js backend"
)

# Enable CORS for frontend requests
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Target Express Node.js Backend API (Local port 3000 or production URL)
NODE_BACKEND_URL = os.getenv("NODE_BACKEND_URL", "http://127.0.0.1:3000")

@app.get("/")
async def root():
    return {
        "status": "ok",
        "service": "Uvicorn FastAPI Gateway",
        "target_node_backend": NODE_BACKEND_URL
    }

@app.get("/health")
async def health():
    return {"status": "ok", "proxy": "uvicorn"}

@app.api_route("/{path:path}", methods=["GET", "POST", "PUT", "DELETE", "PATCH", "OPTIONS"])
async def proxy_all(request: Request, path: str):
    async with httpx.AsyncClient() as client:
        url = f"{NODE_BACKEND_URL}/{path}"
        headers = dict(request.headers)
        headers.pop("host", None)
        body = await request.body()

        try:
            res = await client.request(
                method=request.method,
                url=url,
                headers=headers,
                params=request.query_params,
                content=body,
                timeout=30.0
            )
            return Response(
                content=res.content,
                status_code=res.status_code,
                headers=dict(res.headers)
            )
        except Exception as e:
            return Response(
                content=f'{{"error": "Proxy Error", "message": "{str(e)}"}}',
                status_code=502,
                media_type="application/json"
            )

if __name__ == "__main__":
    import uvicorn
    uvicorn.run("main:app", host="0.0.0.0", port=8000, reload=True)
