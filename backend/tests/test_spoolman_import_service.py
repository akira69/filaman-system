from app.services.spoolman_import_service import SpoolmanImportService


class TestSpoolmanImportColorSupport:
    def test_extract_colors_normalizes_and_preserves_alpha_hex(self):
        service = SpoolmanImportService(None)

        colors = service._extract_colors(
            [
                {
                    "color_hex": "00ffffff",
                    "multi_color_hexes": ["#00FFFFFF", "3C8AD77F", "abc"],
                }
            ]
        )

        assert colors == [
            {"name": "#00FFFFFF", "hex_code": "#00FFFFFF"},
            {"name": "#3C8AD77F", "hex_code": "#3C8AD77F"},
            {"name": "#AABBCC", "hex_code": "#AABBCC"},
        ]
