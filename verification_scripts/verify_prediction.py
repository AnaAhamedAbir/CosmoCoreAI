import requests
import json
import time

BASE_URL = "http://localhost:8000/api/v1"

def main():
    print("=== CosmsoQuantAI ML Prediction Verification ===")
    
    # 1. Register or Login to get token
    user_email = f"test_{int(time.time())}@example.com"
    password = "securepassword123"
    
    print(f"\n[*] Registering test user: {user_email}")
    reg_res = requests.post(f"{BASE_URL}/auth/register", json={
        "email": user_email,
        "password": password,
        "full_name": "Test User"
    })
    
    if reg_res.status_code not in (200, 201):
        print("Registration failed, might exist. Continuing to login.")
    
    print("[*] Logging in...")
    login_res = requests.post(f"{BASE_URL}/auth/login", data={
        "username": user_email,
        "password": password
    })
    
    if login_res.status_code != 200:
        print(f"Login failed: {login_res.text}")
        return
        
    token = login_res.json()["access_token"]
    headers = {"Authorization": f"Bearer {token}"}
    print("[+] Successfully logged in and got access token.")
    
    # 2. Create a dummy ML model
    print("\n[*] Creating a test ML model...")
    # Creating a model requires multipart/form-data
    files = {
        'file': ('dummy_model.pkl', b'dummy content', 'application/octet-stream')
    }
    data = {
        'name': 'Test Price Action Model',
        'model_type': 'price_action',
        'version': 1.0,
        'description': 'A dummy model to test prediction endpoint'
    }
    
    model_res = requests.post(f"{BASE_URL}/ml-models", headers=headers, data=data, files=files)
    
    if model_res.status_code != 200:
        print(f"Failed to create model: {model_res.text}")
        return
        
    model_data = model_res.json()
    model_id = model_data["id"]
    print(f"[+] Successfully created ML model with ID: {model_id}")
    
    # 3. Test the predict endpoint
    price_point = 65000.50
    print(f"\n[*] Testing Prediction API for model {model_id} at price ${price_point}")
    
    url = f"{BASE_URL}/ml-models/{model_id}/predict"
    print(f"[*] Requesting URL: {url}")
    predict_res = requests.post(
        url, 
        headers=headers, 
        json={"price_point": price_point}
    )
    
    if predict_res.status_code == 200:
        print("\n[SUCCESS] Prediction API response:")
        print(json.dumps(predict_res.json(), indent=2))
        
        print("\n[*] Testing determinism (calling same price again)...")
        predict_res_2 = requests.post(
            f"{BASE_URL}/ml-models/{model_id}/predict", 
            headers=headers, 
            json={"price_point": price_point}
        )
        if predict_res_2.json()["signal"] == predict_res.json()["signal"]:
            print("[SUCCESS] Second call returned the same deterministic signal!")
        else:
            print("[WARNING] Second call returned a different signal.")
            
    else:
        print(f"[ERROR] Prediction API failed: {predict_res.status_code} - {predict_res.text}")

if __name__ == "__main__":
    main()
