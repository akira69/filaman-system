from app.services.spoolman_import_service import SpoolmanImportService


class TestSpoolmanImportColorSupport:
    def test_extract_colors_normalizes_alpha_hex_values(self):
        service = SpoolmanImportService(None)

        colors = service._extract_colors(
            [
                {
                    "color_hex": "00d4d488",
                    "multi_color_hexes": ["#00FFFFFF", "3C8AD77F", "be000022", "abc"],
                }
            ]
        )

        assert colors == [
            {"name": "#00D4D488", "hex_code": "#00D4D488"},
            {"name": "#FFFFFF00", "hex_code": "#FFFFFF00"},
            {"name": "#8AD77F3C", "hex_code": "#8AD77F3C"},
            {"name": "#BE000022", "hex_code": "#BE000022"},
            {"name": "#AABBCC", "hex_code": "#AABBCC"},
        ]

    def test_extract_colors_skips_invalid_values(self):
        service = SpoolmanImportService(None)

        colors = service._extract_colors(
            [{"color_hex": "not-a-color", "multi_color_hexes": ["12", "xyz"]}]
        )

        assert colors == []
