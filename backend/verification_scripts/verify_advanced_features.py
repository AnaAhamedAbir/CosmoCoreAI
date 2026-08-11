import sys
import os

# Add backend directory to sys.path
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__))))

from app.services.advanced_features_service import (
    calculate_correlation_matrix,
    validate_custom_formula,
    run_automl_feature_selection
)

def test_correlation_matrix():
    print("Testing Correlation Matrix...")
    features = ['price', 'volume', 'obi', 'spread']
    try:
        result = calculate_correlation_matrix(features)
        assert "matrix" in result
        assert len(result["matrix"]) == len(features)
        print("✅ Correlation Matrix OK")
    except Exception as e:
        print(f"❌ Correlation Matrix Failed: {e}")

def test_custom_formula():
    print("\nTesting Custom Formula...")
    formula = "(buy_volume - sell_volume) / (trade_count + 1)"
    try:
        result = validate_custom_formula(formula)
        assert result.get("valid") is True
        assert "sample_output" in result
        print("✅ Custom Formula Validation OK")
    except Exception as e:
        print(f"❌ Custom Formula Validation Failed: {e}")

def test_automl_selection():
    print("\nTesting AutoML Selection...")
    try:
        result = run_automl_feature_selection()
        assert "top_features" in result
        assert len(result["top_features"]) > 0
        print(f"✅ AutoML Selection OK. Top Features: {result['top_features'][:5]}...")
    except Exception as e:
        print(f"❌ AutoML Selection Failed: {e}")

if __name__ == "__main__":
    print("🚀 Starting Advanced Features Verification...\n")
    test_correlation_matrix()
    test_custom_formula()
    test_automl_selection()
    print("\n✅ All Tests Finished.")
