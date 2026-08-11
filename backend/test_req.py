import urllib.request
try:
    req = urllib.request.Request('http://localhost:8000/api/v1/model-training/predict', data=b'{"model_id": "model_1785327931023", "symbol": "BTC/USDT"}', headers={'Content-Type': 'application/json'})
    res = urllib.request.urlopen(req)
    print(res.read().decode('utf-8'))
except urllib.error.HTTPError as e:
    print(f"HTTPError: {e.code}")
    print(e.read().decode('utf-8'))
