import pytorch_lightning
import os

ptl_dir = os.path.dirname(pytorch_lightning.__file__)
os.system(f"grep -rn 'The provided lr scheduler' {ptl_dir}")
