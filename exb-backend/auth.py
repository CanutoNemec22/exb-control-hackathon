import os
from datetime import datetime, timedelta, timezone
import jwt
from fastapi import Depends, HTTPException, status
from fastapi.security import HTTPBearer, HTTPAuthorizationCredentials

SECRET_KEY = os.getenv("JWT_SECRET", "clave_secreta_exb_hackathon_2026")
ALGORITHM = "HS256"
security = HTTPBearer()

def crear_token(usuario_id: int, email: str, rol: str, nombre: str):
    payload = {
        "sub": str(usuario_id),
        "email": email,
        "rol": rol,
        "nombre": nombre,
        "exp": datetime.now(timezone.utc) + timedelta(hours=12)
    }
    return jwt.encode(payload, SECRET_KEY, algorithm=ALGORITHM)

def obtener_usuario_actual(credentials: HTTPAuthorizationCredentials = Depends(security)):
    try:
        return jwt.decode(credentials.credentials, SECRET_KEY, algorithms=[ALGORITHM])
    except jwt.ExpiredSignatureError:
        raise HTTPException(status_code=401, detail="Sesión expirada")
    except jwt.InvalidTokenError:
        raise HTTPException(status_code=401, detail="Token inválido")

def solo_admin(usuario: dict = Depends(obtener_usuario_actual)):
    if usuario.get("rol") != "ADMIN":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="Acceso denegado: solo el Administrador puede realizar esta acción"
        )
    return usuario