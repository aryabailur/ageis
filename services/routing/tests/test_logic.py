import os

import pytest

from app import logic


def test_haversine_fallback_is_used_without_api_key(monkeypatch):
    monkeypatch.delenv("MAPBOX_API_KEY", raising=False)
    result = logic.route_estimate(42.3601, -71.0589, 42.3520, -71.0750)
    assert result["data_source"] == "haversine_fallback"
    assert result["distance_km"] > 0
    assert result["eta_minutes"] > 0


def test_traffic_aware_is_slower_than_free_flow():
    free_flow = logic.route_estimate_haversine_fallback(
        42.3601, -71.0589, 42.3520, -71.0750, traffic_aware=False
    )
    with_traffic = logic.route_estimate_haversine_fallback(
        42.3601, -71.0589, 42.3520, -71.0750, traffic_aware=True
    )
    assert with_traffic["eta_minutes"] > free_flow["eta_minutes"]


class _FakeMapboxResponse:
    def __init__(self, payload):
        self._payload = payload

    def raise_for_status(self):
        pass

    def json(self):
        return self._payload


def test_live_provider_parses_mapbox_response_and_is_used_when_key_present(monkeypatch):
    monkeypatch.setenv("MAPBOX_API_KEY", "test-key")

    captured_urls = []

    def fake_get(url, params=None, timeout=None):
        captured_urls.append(url)
        return _FakeMapboxResponse({"routes": [{"distance": 5000, "duration": 420}]})

    monkeypatch.setattr(logic.httpx, "get", fake_get)

    result = logic.route_estimate(42.3601, -71.0589, 42.3520, -71.0750)
    assert result == {"distance_km": 5.0, "eta_minutes": 7.0, "data_source": "mapbox_driving_traffic"}
    assert "driving-traffic" in captured_urls[0]


def test_live_provider_falls_back_to_haversine_on_mapbox_failure(monkeypatch):
    monkeypatch.setenv("MAPBOX_API_KEY", "test-key")

    def failing_get(url, params=None, timeout=None):
        raise TimeoutError("mapbox took too long")

    monkeypatch.setattr(logic.httpx, "get", failing_get)

    result = logic.route_estimate(42.3601, -71.0589, 42.3520, -71.0750)
    assert result["data_source"] == "haversine_fallback"


@pytest.mark.skipif(not os.environ.get("MAPBOX_API_KEY"), reason="MAPBOX_API_KEY not configured")
def test_live_mapbox_provider_against_the_real_api():
    result = logic.route_estimate_live_provider(42.3601, -71.0589, 42.3520, -71.0750)
    assert result["data_source"].startswith("mapbox_")
    assert result["distance_km"] > 0
    assert result["eta_minutes"] > 0
