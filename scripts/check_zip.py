import zipfile
import sys

def list_zip(zip_path):
    with zipfile.ZipFile(zip_path, 'r') as zipf:
        for name in zipf.namelist():
            print(name)
            if name == "module.prop":
                print("FOUND module.prop at ROOT!")

if __name__ == "__main__":
    list_zip("Miru_UI_Module_v5.1_Final.zip")
