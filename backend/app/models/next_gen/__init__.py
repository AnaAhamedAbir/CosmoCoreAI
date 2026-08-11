"""
Next-Gen Models Directory
Houses state-of-the-art AI architectures for CosmoQuantAI.
"""

from .mamba_ssm import MambaSSMModel
from .kan_network import KANNetworkModel
from .jepa_world_model import JEPAWorldModel
from .time_llm import TimeLLMModel
from .ttft import TTFTModel
from .gnn_rl import GNNRLModel
from .snn_liquid import SNNLiquidModel
from .sparse_moe_router import SparseMoERouterModel

NEXT_GEN_MODELS = {
    "mamba_ssm": MambaSSMModel,
    "kan_network": KANNetworkModel,
    "jepa_world_model": JEPAWorldModel,
    "time_llm": TimeLLMModel,
    "ttft": TTFTModel,
    "gnn_rl": GNNRLModel,
    "snn_liquid": SNNLiquidModel,
    "sparse_moe_router": SparseMoERouterModel
}
