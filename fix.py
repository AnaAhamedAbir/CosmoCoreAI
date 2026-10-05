import re
with open(r'C:\CosmoCoreAI\backend\app\services\bracket_order_service.py', 'r', encoding='utf-8') as f:
    text = f.read()

pattern = r'f\"Exit Price: ~\s*\{current_price\}\\n\"[\s\S]*?NotificationService\.send_message\(db, user_id, msg\)'

replacement = '''f\"Exit Price: ~{current_price}\\n\"\n                            f\"Mode: {f\'ATR (TF: {atr_timeframe}, Period: {atr_period}, Mult: {atr_multiplier})\' if mode == \'atr\' else f\'{mode} ({val}{\\'%\\' if mode == \\'percentage\\' else \\'$\\'})\'}\"\n                        )\n                        await NotificationService.send_message(db, user_id, msg)'''

text = re.sub(pattern, replacement, text)

with open(r'C:\CosmoCoreAI\backend\app\services\bracket_order_service.py', 'w', encoding='utf-8') as f:
    f.write(text)
