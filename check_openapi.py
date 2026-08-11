import requests
res = requests.get("http://localhost:8000/api/v1/openapi.json")
data = res.json()
paths = data.get("paths", {})
found = False
for path in paths.keys():
    if "predict" in path:
        print(f"FOUND PREDICT ROUTE: {path}")
        found = True
if not found:
    print("NO PREDICT ROUTE FOUND IN OPENAPI")
