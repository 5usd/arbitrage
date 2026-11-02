import math
import unittest

from engine import find_triangles
from server import clean_settings


class PricingTests(unittest.TestCase):
    def setUp(self):
        self.symbols = [
            {"symbol": "AAAUSDT", "base": "AAA", "quote": "USDT"},
            {"symbol": "BBBAAA", "base": "BBB", "quote": "AAA"},
            {"symbol": "BBBUSDT", "base": "BBB", "quote": "USDT"},
        ]
        self.prices = {
            "AAAUSDT": {"bid": 99.99, "ask": 100},
            "BBBAAA": {"bid": 1.9999, "ask": 2},
            "BBBUSDT": {"bid": 201, "ask": 201.01},
        }
        self.settings = {"fee_percent": 0.1, "min_profit_percent": 0.05}

    def test_uses_two_asks_one_bid_and_fees_on_three_legs(self):
        result = find_triangles(self.symbols, self.prices, {"AAA", "BBB"}, self.settings)
        self.assertEqual(len(result), 1)
        self.assertEqual(result[0]["route"], ["USDT", "AAA", "BBB", "USDT"])
        self.assertAlmostEqual(result[0]["profit"], ((201 / 200) * 0.999**3 - 1) * 100, places=5)

    def test_unprofitable_after_fees_is_not_reported(self):
        self.prices["BBBUSDT"] = {"bid": 200.2, "ask": 200.21}
        self.assertEqual(find_triangles(self.symbols, self.prices, {"AAA", "BBB"}, self.settings), [])

    def test_wide_spread_is_excluded(self):
        self.prices["BBBAAA"]["bid"] = 1.9
        self.assertEqual(find_triangles(self.symbols, self.prices, {"AAA", "BBB"}, self.settings), [])

    def test_nonfinite_negative_and_malformed_settings_are_ignored(self):
        for value in [math.nan, math.inf, -1, "invalid", None]:
            self.assertEqual(clean_settings({"fee_percent": value}, self.settings), self.settings)
        changed = clean_settings({"fee_percent": 0.2}, self.settings)
        self.assertEqual(changed["fee_percent"], 0.2)
        self.assertEqual(self.settings["fee_percent"], 0.1)


if __name__ == "__main__":
    unittest.main()
