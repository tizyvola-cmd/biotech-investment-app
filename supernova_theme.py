"""Tema visivo SuperNova (palette icona: navy, arancio, blu, testo chiaro)."""
from __future__ import annotations

import tkinter as tk
from tkinter import ttk


# Palette allineata all’identità visiva SuperNova
NAVY = "#0c1929"
NAVY_PANEL = "#152238"
SLATE = "#1e3a5f"
ORANGE = "#ea580c"
ORANGE_LIGHT = "#fb923c"
BLUE = "#3b82f6"
TEXT = "#f1f5f9"
TEXT_MUTED = "#94a3b8"
ACCENT_BG = "#334155"
# Data lab: pannello navigazione fogli
DATALAB_SIDEBAR = "#0a1524"


def apply_supernova_style(root: tk.Tk) -> ttk.Style:
    root.configure(bg=NAVY)
    style = ttk.Style(root)
    try:
        style.theme_use("clam")
    except Exception:
        pass

    style.configure(".", background=NAVY_PANEL, foreground=TEXT, fieldbackground=NAVY_PANEL)
    style.configure("TFrame", background=NAVY_PANEL)
    style.configure("TLabel", background=NAVY_PANEL, foreground=TEXT)
    style.configure(
        "Header.TLabel",
        background=NAVY,
        foreground=TEXT,
        font=("Segoe UI", 11, "bold"),
    )
    style.configure(
        "Sub.TLabel",
        background=NAVY,
        foreground=TEXT_MUTED,
        font=("Segoe UI", 9),
    )

    style.configure(
        "TNotebook",
        background=NAVY,
        borderwidth=0,
        tabmargins=[6, 4, 0, 0],
    )
    style.configure(
        "TNotebook.Tab",
        padding=[18, 10],
        font=("Segoe UI", 10, "bold"),
        background=SLATE,
        foreground=TEXT_MUTED,
    )
    style.map(
        "TNotebook.Tab",
        background=[("selected", ORANGE), ("!selected", SLATE)],
        foreground=[("selected", "#ffffff"), ("!selected", TEXT_MUTED)],
        expand=[("selected", [1, 1, 1, 0])],
    )

    style.configure(
        "TLabelFrame",
        background=NAVY_PANEL,
        foreground=ORANGE_LIGHT,
        bordercolor=SLATE,
        relief="solid",
        borderwidth=1,
    )
    style.configure("TLabelFrame.Label", background=NAVY_PANEL, foreground=ORANGE_LIGHT)

    style.configure("TButton", font=("Segoe UI", 9))
    style.map(
        "TButton",
        background=[("active", ORANGE), ("!disabled", SLATE)],
        foreground=[("!disabled", TEXT)],
    )

    style.configure("TRadiobutton", background=NAVY_PANEL, foreground=TEXT)
    style.configure("TCheckbutton", background=NAVY_PANEL, foreground=TEXT)

    style.configure(
        "Accent.TButton",
        font=("Segoe UI", 9, "bold"),
        foreground="#ffffff",
    )
    style.map(
        "Accent.TButton",
        background=[("active", ORANGE_LIGHT), ("!disabled", ORANGE)],
        foreground=[("!disabled", "#ffffff")],
    )

    style.configure(
        "Treeview",
        background=NAVY,
        fieldbackground=NAVY,
        foreground=TEXT,
        rowheight=22,
        font=("Consolas", 9),
    )
    style.configure(
        "Treeview.Heading",
        background=SLATE,
        foreground="#fff7ed",
        font=("Segoe UI", 9, "bold"),
        relief="flat",
    )
    style.map("Treeview", background=[("selected", ORANGE)])

    style.configure("Vertical.TScrollbar", background=SLATE, troughcolor=NAVY)
    style.configure("Horizontal.TScrollbar", background=SLATE, troughcolor=NAVY)

    style.configure("TCombobox", fieldbackground=NAVY, background=SLATE, foreground=TEXT)
    style.configure("TEntry", fieldbackground=NAVY, foreground=TEXT)

    return style
