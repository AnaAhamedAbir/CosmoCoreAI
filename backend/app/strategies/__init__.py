"""Lazy package initializer for `app.strategies`.

Deferring imports of `backtrader`, `cascading_bb`, and `STRATEGY_MAP` avoids
loading ~263 MiB into processes that only import strategy helpers or live bots.
"""

import importlib

_LAZY_EXPORTS = (
    "bt",
    "btind",
    "BaseStrategy",
    "CascadingBBBot",
    "GenericOscillatorStrategy",
    "GenericCrossoverStrategy",
    "GenericSignalStrategy",
    "INDICATOR_CONFIG",
    "MacdStrategy",
    "MacdHistogramStrategy",
    "BollingerBandsStrategy",
    "BollingerSqueezeStrategy",
    "AtrBreakout",
    "ParabolicSarStrategy",
    "AdxStrategy",
    "PriceChannelStrategy",
    "SuperTrendStrategy",
    "IchimokuStrategy",
    "STRATEGY_MAP",
    "load_custom_strategies",
)


def _load_registry():
    registry = importlib.import_module(".strategies._registry", package="app")
    g = globals()
    for sym in _LAZY_EXPORTS:
        if hasattr(registry, sym):
            g[sym] = getattr(registry, sym)
    return registry


def __getattr__(name: str):
    if name in _LAZY_EXPORTS:
        registry = _load_registry()
        return getattr(registry, name)
    raise AttributeError(f"module {__name__!r} has no attribute {name!r}")


def __dir__():
    return sorted(set(list(globals().keys()) + list(_LAZY_EXPORTS)))
