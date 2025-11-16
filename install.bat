@echo off
echo Installing Ed Share Dependencies...
echo.

echo Installing root dependencies...
call npm install

echo.
echo Installing server dependencies...
cd server
call npm install
cd ..

echo.
echo Installing client dependencies...
cd client
call npm install
cd ..

echo.
echo Creating environment files...
if not exist "server\.env" (
    copy "server\.env.example" "server\.env"
    echo Created server\.env from example
)

if not exist "client\.env" (
    copy "client\.env.example" "client\.env"
    echo Created client\.env from example
)

echo.
echo Creating upload directories...
if not exist "server\uploads" mkdir "server\uploads"
if not exist "server\uploads\tutors" mkdir "server\uploads\tutors"
if not exist "server\uploads\students" mkdir "server\uploads\students"
if not exist "server\uploads\documents" mkdir "server\uploads\documents"

echo.
echo Installation complete!
echo.
echo Next steps:
echo 1. Update environment variables in server\.env and client\.env
echo 2. Start MongoDB (or use Docker: docker-compose up mongodb)
echo 3. Run the development servers: npm run dev
echo.
pause
