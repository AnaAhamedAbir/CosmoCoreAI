import os

def patch_file(filepath):
    with open(filepath, 'r', encoding='utf-8') as f:
        content = f.read()
    
    target_str = """                            if allowed:
                                self.logger.info(f"🤖 [God Mode ML] TRIGGER FIRED! Score: {g_score} | Executing {target_side.upper()} Snipe!")"""
    
    replacement_str = """                            if allowed:
                                # Confluence Check: L2 Machine Learning Filter
                                if getattr(self, 'enable_ml_filter', False) and getattr(self, 'ml_predictor', None):
                                    ml_mode = getattr(self, 'ml_execution_mode', 'basic')
                                    is_ai_valid = False
                                    if ml_mode == 'advanced':
                                        advanced_setup = await self.ml_predictor.predict_advanced(orderbook, mid_price, target_side, self)
                                        if advanced_setup and advanced_setup.get("is_valid", False):
                                            is_ai_valid = True
                                    else:
                                        is_ai_valid = await self.ml_predictor.predict(orderbook, mid_price, target_side)
                                        
                                    if not is_ai_valid:
                                        self.logger.info(f"🚫 [God Mode ML] Snipe at {mid_price} rejected by L2 ML Predictor Confluence!")
                                        allowed = False

                                # Confluence Check: Dual Engine
                                if allowed and getattr(self, "dual_engine_tracker", None) and self.dual_engine_tracker.is_enabled:
                                    if not self.dual_engine_tracker.is_aligned(target_side):
                                        self.logger.info(f"🚫 [God Mode ML] Snipe at {mid_price} rejected by Dual Engine Confluence!")
                                        allowed = False

                            if allowed:
                                self.logger.info(f"🤖 [God Mode ML] TRIGGER FIRED! Score: {g_score} | Executing {target_side.upper()} Snipe!")"""
                                
    if target_str in content:
        new_content = content.replace(target_str, replacement_str)
        with open(filepath, 'w', encoding='utf-8') as f:
            f.write(new_content)
        print(f"Patched {filepath}")
    else:
        print(f"Target string not found in {filepath}")

patch_file(r'c:\CosmoCoreAI\backend\app\strategies\wall_hunter_bot.py')
patch_file(r'c:\CosmoCoreAI\backend\app\strategies\wall_hunter_futures.py')
