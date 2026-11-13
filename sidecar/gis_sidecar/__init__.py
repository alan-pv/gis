"""gis_sidecar: the logic behind the Gis sidecar server.

Laya (a non-autoregressive encoder) decides the structure of each turn through
multiple-choice questions; a small ollama model writes the text of the blanks;
the pieces are assembled into an envelope for the web app. Only the standard
library is needed here (torch and `laya` are imported lazily by the server).
"""
