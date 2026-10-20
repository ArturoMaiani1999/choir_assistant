"""Compatibility entry point for the unified guide in headphone mode."""
import sys
from browser_audio_calibration_smoke import main

if __name__ == '__main__':
    sys.argv.append('--headphones')
    main()
