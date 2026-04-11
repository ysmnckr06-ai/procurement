from fastapi import FastAPI, UploadFile, File
import pandas as pd

app = FastAPI()

@app.get("/")
def read_root():
    return {"message": "Backend çalışıyor"}

@app.post("/upload-excel")
async def upload_excel(file: UploadFile = File(...)):
    df = pd.read_excel(file.file)

    data = df.to_dict(orient="records")

    return {
        "columns": list(df.columns),
        "data": data[:10]  # ilk 10 satır preview
    }