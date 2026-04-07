from app.services.spoolman_import_service import SpoolmanImportService


class TestSpoolmanImportColorNormalization:
    def test_normalize_hex_code_supports_alpha_values(self):
        assert SpoolmanImportService._normalize_hex_code("00FFFFFF") == "#ffffff"
        assert SpoolmanImportService._normalize_hex_code("3C8AD77F") == "#8ad77f"
        assert SpoolmanImportService._normalize_hex_code("abc") == "#aabbcc"

    def test_extract_colors_normalizes_and_deduplicates_alpha_values(self):
        service = SpoolmanImportService(None)

        colors = service._extract_colors(
            [
                {
                    "color_hex": "00FFFFFF",
                    "multi_color_hexes": ["3C8AD77F", "#3C8AD77F", "112233"],
                }
            ]
        )

        assert [color["hex_code"] for color in colors] == [
            "#ffffff",
            "#8ad77f",
            "#112233",
        ]

    def test_extract_colors_skips_invalid_values(self):
        service = SpoolmanImportService(None)

        colors = service._extract_colors(
            [{"color_hex": "not-a-color", "multi_color_hexes": ["12", "xyz"]}]
        )

        assert colors == []
