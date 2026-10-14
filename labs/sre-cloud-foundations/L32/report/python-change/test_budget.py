import unittest

from budget import remaining


class T(unittest.TestCase):
    def test_no_traffic_is_full_budget(self):
        self.assertEqual(remaining(0.995, 0, 0), 1.0)

    def test_half_spent(self):
        self.assertAlmostEqual(remaining(0.99, 995, 1000), 0.5)

    def test_overspent_floors_at_zero(self):
        self.assertEqual(remaining(0.99, 900, 1000), 0.0)

    def test_bad_slo(self):
        with self.assertRaises(ValueError):
            remaining(1.5, 1, 1)


if __name__ == "__main__":
    unittest.main()
