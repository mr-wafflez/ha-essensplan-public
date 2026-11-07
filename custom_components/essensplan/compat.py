"""Support HA's current validator and older installations."""
try:
    import probatio as vol
except ImportError:
    import voluptuous as vol
