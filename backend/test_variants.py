#!/usr/bin/env python3
"""Test payload variants generation"""
import sys
import json

# Add backend to path
sys.path.insert(0, '/app/backend')

from liquid_charts_api import LiquidChartsAPI

# Test payload like the frontend sends
test_payload = {
    "symbols": ["NAS100"],
    "timeframe": "1h",
    "limit": 200,
    "type": "candles",
    "market": "spot"
}

print("=" * 70)
print("Testing marketdata payload variants")
print("=" * 70)
print(f"\nInput payload: {json.dumps(test_payload, indent=2)}")

variants = LiquidChartsAPI._marketdata_payload_variants(test_payload)

print(f"\nGenerated {len(variants)} variants:\n")
for i, variant in enumerate(variants, 1):
    print(f"Variant #{i}:")
    print(f"  {json.dumps(variant)}")
    print()

# Check for null values
print("=" * 70)
print("Checking for null values in variants:")
for i, variant in enumerate(variants, 1):
    has_null = any(v is None for v in variant.values())
    if has_null:
        print(f"⚠️  Variant #{i} contains null values:")
        for k, v in variant.items():
            if v is None:
                print(f"   {k}: {v}")
    else:
        print(f"✓ Variant #{i}: No null values")

print("\n" + "=" * 70)
print("Variant generation test complete")
