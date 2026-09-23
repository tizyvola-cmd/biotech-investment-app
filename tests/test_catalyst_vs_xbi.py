from catalyst_vs_xbi import build_vs_xbi_row, relative_move_simple, simple_return


def test_simple_return():
    closes = [10, 10.2, 10.1, 10.4, 10.5, 11.0]
    assert abs(simple_return(closes, 5) - 0.1) < 1e-9
    assert simple_return([10, 11], 5) is None


def test_relative_move_never_invents():
    assert relative_move_simple(0.05, None) is None
    assert relative_move_simple(None, 0.02) is None
    assert abs(relative_move_simple(0.05, 0.02) - 0.03) < 1e-9


def test_row_builder():
    stock = [100, 101, 102, 103, 104, 110]
    xbi = [50, 50.5, 51, 51.2, 51.5, 52]
    row = build_vs_xbi_row("GRAL", stock_closes=stock, xbi_closes=xbi, days=5)
    assert row["relative_move"] is not None
    assert row["method"] == "simple_beta1"
    assert row["status"] == "ok"
