"""Local comparison harness for the existing Basic renderer, not a new API."""
import base64
import json
import sys
from io import BytesIO
from pathlib import Path
from time import perf_counter

sys.path.insert(0, str(Path(__file__).resolve().parents[3] / "backend"))
from app.services.label_v2_renderer import render_v2_label

payload = json.loads(sys.argv[1])
design, data = payload["preset"]["design"], payload["data"]
def flatten(value, prefix=""):
    return {f"{prefix}{key}": str(item) for key, item in value.items() if not isinstance(item, dict)} | {
        child: item for key, nested in value.items() if isinstance(nested, dict)
        for child, item in flatten(nested, f"{prefix}{key}.").items()
    }

values = flatten(data)
assets = {key: base64.b64decode(value["dataUrl"].split(",", 1)[1]) for key, value in payload["assets"].items()}
width = round(design["label"]["widthMm"] * payload["dpi"] / 25.4)
height = round(design["label"]["heightMm"] * payload["dpi"] / 25.4)
start = perf_counter()
entity_path = payload.get("entityPath", "spools")
entity_id = data.get("filament.id", data["id"]) if entity_path == "filaments" else data["id"]
image = render_v2_label(design, width, values, ["#138c81"], f"https://fila.test/{entity_path}/{entity_id}", assets.get("logo"), assets, payload.get("thermal", True), height, raw_values=data)
elapsed = (perf_counter() - start) * 1000
if payload.get("thermal", True):
    image = image.convert("L").point(lambda value: 255 if value >= payload["threshold"] else 0, mode="1")
output = BytesIO()
image.save(output, format="PNG")
print(json.dumps({"png": base64.b64encode(output.getvalue()).decode(), "milliseconds": elapsed}))
