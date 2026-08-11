import pandas as pd
from app.services.advanced_ml.trading_env import AdvancedTradingEnv
from app.services.advanced_ml.data_handler import AdvancedDataHandler

df = pd.DataFrame({
    'timestamp': pd.date_range('2023-01-01', periods=10),
    'Close': [60000, 60100, 60200, 60300, 60400, 60500, 60600, 60700, 60800, 60900],
    'Feature1': [1, 2, 3, 4, 5, 6, 7, 8, 9, 10]
})

features = ['Feature1']
res_df = AdvancedDataHandler.prepare_rl_data(df, features)
print("Columns in res_df:", res_df.columns)

env = AdvancedTradingEnv(df=res_df, is_continuous=True)
obs, info = env.reset()
print("Feature cols in env:", env.feature_cols)
print("Observation:", obs)
