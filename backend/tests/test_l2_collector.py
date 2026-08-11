import subprocess
import os
import sys

def test_l2_collector():
    script_path = os.path.join(os.getcwd(), "app", "..", "scripts", "l2_collector.py")
    
    print(f"Testing L2 Collector Script: {script_path}")
    print("Running for 200 rows to test fast execution and chunk merging...")
    
    try:
        # Run the collector in blocking mode to see the output
        result = subprocess.run(
            ["python", script_path, "--symbol", "btcusdt", "--target", "200"],
            capture_output=True,
            text=True
        )
        
        print("--- STDOUT ---")
        print(result.stdout)
        
        print("--- STDERR ---")
        print(result.stderr)
        
        if result.returncode == 0:
            print("L2 Collector test passed successfully!")
            return True
        else:
            print(f"L2 Collector test failed with return code: {result.returncode}")
            return False
            
    except Exception as e:
        print(f"Exception occurred: {str(e)}")
        return False

if __name__ == "__main__":
    success = test_l2_collector()
    sys.exit(0 if success else 1)
