# Ed Share - Setup and Installation Guide

This guide will help you set up and run the Ed Share EdTech marketplace on your local machine and deploy it to production.

## Prerequisites

Before you begin, ensure you have the following installed on your system:

### Required Software
- **Node.js** (v18.0.0 or higher) - [Download here](https://nodejs.org/)
- **MongoDB** (v6.0 or higher) - [Download here](https://www.mongodb.com/try/download/community)
- **Git** - [Download here](https://git-scm.com/downloads)

### Optional (for production deployment)
- **Docker** and **Docker Compose** - [Download here](https://www.docker.com/products/docker-desktop/)
- **Nginx** (for reverse proxy)

## Project Structure

```
ed-share/
├── server/                 # Backend API (Node.js + Express)
├── client/                 # Frontend App (React + TypeScript)
├── docker-compose.yml      # Docker configuration
├── install.bat            # Windows installation script
├── package.json           # Root package.json
└── README.md              # Project documentation
```

## Installation Steps

### Step 1: Clone or Navigate to Project Directory

If you're setting this up from the existing files:
```bash
cd "c:\xampp\htdocs\education share"
```

### Step 2: Install Node.js Dependencies

#### Install Root Dependencies
```bash
npm install
```

#### Install Server Dependencies
```bash
cd server
npm install
cd ..
```

#### Install Client Dependencies
```bash
cd client
npm install
cd ..
```

### Step 3: Set Up Environment Variables

#### Server Environment (.env)
Create `server/.env` file by copying from the example:
```bash
copy server\.env.example server\.env
```

Edit `server/.env` with your actual values:
```env
NODE_ENV=development
PORT=5000
MONGODB_URI=mongodb://localhost:27017/edshare
JWT_SECRET=your_super_secret_jwt_key_here_make_it_long_and_random_at_least_32_characters
JWT_EXPIRE=7d

# Google APIs (Required for Maps and Location services)
GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here

# Payment Gateways
RAZORPAY_KEY_ID=your_razorpay_key_id
RAZORPAY_KEY_SECRET=your_razorpay_key_secret
STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
STRIPE_SECRET_KEY=your_stripe_secret_key

# KYC Service (Optional - for production)
KYC_API_KEY=your_kyc_api_key
KYC_API_URL=https://api.kyc-provider.com/v1

# Email Service (Required for notifications)
EMAIL_FROM=noreply@edshare.com
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_USER=your_email@gmail.com
SMTP_PASS=your_app_password

# File Upload Settings
MAX_FILE_SIZE=5242880
UPLOAD_PATH=./uploads

# Security
BCRYPT_ROUNDS=12
RATE_LIMIT_WINDOW=15
RATE_LIMIT_MAX=100

# Admin Settings
ADMIN_EMAIL=admin@edshare.com
ADMIN_PASSWORD=admin123456
```

#### Client Environment (.env)
Create `client/.env` file by copying from the example:
```bash
copy client\.env.example client\.env
```

Edit `client/.env` with your values:
```env
REACT_APP_API_URL=http://localhost:5000/api
REACT_APP_GOOGLE_MAPS_API_KEY=your_google_maps_api_key_here
REACT_APP_RAZORPAY_KEY_ID=your_razorpay_key_id
REACT_APP_STRIPE_PUBLISHABLE_KEY=your_stripe_publishable_key
REACT_APP_SOCKET_URL=http://localhost:5000
REACT_APP_APP_NAME=Ed Share
REACT_APP_APP_VERSION=1.0.0
```

### Step 4: Set Up MongoDB Database

#### Option A: Local MongoDB Installation
1. Install MongoDB Community Edition
2. Start MongoDB service:
   ```bash
   # Windows (as Administrator)
   net start MongoDB
   
   # Or start manually
   mongod --dbpath "C:\data\db"
   ```

#### Option B: MongoDB Atlas (Cloud)
1. Create account at [MongoDB Atlas](https://www.mongodb.com/cloud/atlas)
2. Create a new cluster
3. Get connection string and update `MONGODB_URI` in server/.env

#### Option C: Docker MongoDB
```bash
docker run -d --name edshare-mongodb -p 27017:27017 -e MONGO_INITDB_ROOT_USERNAME=admin -e MONGO_INITDB_ROOT_PASSWORD=password123 mongo:7.0
```

### Step 5: Create Upload Directories

Create necessary directories for file uploads:
```bash
mkdir server\uploads
mkdir server\uploads\tutors
mkdir server\uploads\students
mkdir server\uploads\avatars
mkdir server\uploads\documents
```

### Step 6: API Keys Setup

#### Google Maps API Key
1. Go to [Google Cloud Console](https://console.cloud.google.com/)
2. Create a new project or select existing one
3. Enable the following APIs:
   - Maps JavaScript API
   - Geocoding API
   - Distance Matrix API
   - Places API
4. Create credentials (API Key)
5. Restrict the API key to your domain for security

#### Razorpay Setup (Primary Payment Gateway)
1. Sign up at [Razorpay](https://razorpay.com/)
2. Get API keys from Dashboard > Settings > API Keys
3. For testing, use test keys
4. For production, complete KYC and get live keys

#### Stripe Setup (Fallback Payment Gateway)
1. Sign up at [Stripe](https://stripe.com/)
2. Get API keys from Dashboard > Developers > API keys
3. Use test keys for development

#### Email Service Setup (Gmail Example)
1. Enable 2-factor authentication on your Gmail account
2. Generate an App Password:
   - Go to Google Account settings
   - Security > 2-Step Verification > App passwords
   - Generate password for "Mail"
3. Use your email and the generated app password in .env

## Running the Application

### Development Mode

#### Option 1: Run Both Services Together
```bash
npm run dev
```

#### Option 2: Run Services Separately

**Terminal 1 - Backend:**
```bash
cd server
npm run dev
```

**Terminal 2 - Frontend:**
```bash
cd client
npm start
```

### Production Mode

#### Build and Start
```bash
# Build frontend
cd client
npm run build
cd ..

# Start backend
cd server
npm start
```

## Docker Deployment

### Using Docker Compose (Recommended)

1. **Create environment file for Docker:**
   ```bash
   copy .env.example .env
   ```

2. **Update .env with your production values**

3. **Start all services:**
   ```bash
   docker-compose up -d
   ```

4. **View logs:**
   ```bash
   docker-compose logs -f
   ```

5. **Stop services:**
   ```bash
   docker-compose down
   ```

### Services Included in Docker Setup:
- **MongoDB** - Database (Port: 27017)
- **Redis** - Caching and sessions (Port: 6379)
- **Backend API** - Node.js server (Port: 5000)
- **Frontend** - React app (Port: 3000)
- **Nginx** - Reverse proxy (Port: 80/443)

## Accessing the Application

Once everything is running:

- **Frontend**: http://localhost:3000
- **Backend API**: http://localhost:5000/api
- **API Health Check**: http://localhost:5000/api/health
- **API Documentation**: http://localhost:5000/api/docs (development only)

## Default Admin Account

After first run, you can create an admin account using the registration endpoint or directly in the database:

```javascript
// Example admin user creation (run in MongoDB shell)
use edshare
db.users.insertOne({
  firstName: "Admin",
  lastName: "User",
  email: "admin@edshare.com",
  phone: "9876543210",
  password: "$2a$12$hashed_password_here", // Use bcrypt to hash
  role: "admin",
  status: "active",
  isEmailVerified: true,
  isPhoneVerified: true,
  isSuperAdmin: true,
  createdAt: new Date(),
  updatedAt: new Date()
})
```

## Testing the Setup

### 1. Backend API Test
```bash
curl http://localhost:5000/api/health
```
Should return: `{"status":"OK","timestamp":"...","environment":"development"}`

### 2. Frontend Test
Open http://localhost:3000 in your browser. You should see the Ed Share homepage.

### 3. Database Connection Test
Check MongoDB connection in server logs. Should show: `✅ MongoDB connected successfully`

## Troubleshooting

### Common Issues

#### 1. MongoDB Connection Failed
- **Issue**: `MongoDB connection error`
- **Solution**: 
  - Ensure MongoDB is running
  - Check MONGODB_URI in .env
  - Verify network connectivity

#### 2. Port Already in Use
- **Issue**: `Error: listen EADDRINUSE :::5000`
- **Solution**: 
  - Change PORT in server/.env
  - Kill process using the port: `netstat -ano | findstr :5000`

#### 3. NPM Install Fails
- **Issue**: Package installation errors
- **Solution**:
  - Clear npm cache: `npm cache clean --force`
  - Delete node_modules and package-lock.json
  - Run `npm install` again

#### 4. Google Maps Not Loading
- **Issue**: Maps not displaying
- **Solution**:
  - Verify GOOGLE_MAPS_API_KEY is correct
  - Check API key restrictions
  - Ensure required APIs are enabled

#### 5. Payment Gateway Errors
- **Issue**: Payment processing fails
- **Solution**:
  - Verify API keys are correct
  - Check if using test/live keys appropriately
  - Ensure webhook URLs are configured

### Environment-Specific Issues

#### Windows
- Use `npm run dev` instead of `npm start` for development
- Ensure MongoDB service is running
- Use PowerShell or Command Prompt as Administrator

#### macOS/Linux
- Use `sudo` for global npm installations if needed
- Ensure proper file permissions for upload directories

## Production Deployment

### Prerequisites for Production
1. Domain name and SSL certificate
2. Production MongoDB instance
3. Production API keys (Razorpay live, Google Maps with domain restrictions)
4. Email service (SendGrid, AWS SES, etc.)
5. File storage service (AWS S3, Cloudinary, etc.)

### Deployment Checklist
- [ ] Update all environment variables for production
- [ ] Set up SSL certificates
- [ ] Configure domain and DNS
- [ ] Set up monitoring and logging
- [ ] Configure backup strategy for database
- [ ] Set up CI/CD pipeline
- [ ] Configure error tracking (Sentry, etc.)
- [ ] Set up performance monitoring

### Recommended Production Stack
- **Hosting**: AWS EC2, DigitalOcean, or similar
- **Database**: MongoDB Atlas or self-hosted MongoDB
- **CDN**: CloudFlare or AWS CloudFront
- **File Storage**: AWS S3 or similar
- **Monitoring**: New Relic, DataDog, or similar
- **Error Tracking**: Sentry
- **CI/CD**: GitHub Actions, GitLab CI, or similar

## Support and Documentation

### API Documentation
- Development: http://localhost:5000/api/docs
- Postman Collection: Available in `/docs` folder

### Key Features Implemented
- ✅ Multi-role authentication (Student, Tutor, Employee, Admin)
- ✅ Location-based tutor search (5km radius)
- ✅ Real-time chat with Socket.io
- ✅ Payment integration (Razorpay + Stripe)
- ✅ KYC verification for tutors
- ✅ Booking and session management
- ✅ Admin panel with analytics
- ✅ Responsive UI with Tailwind CSS
- ✅ File upload and management
- ✅ Email and SMS notifications

### Need Help?
1. Check the troubleshooting section above
2. Review server logs for error details
3. Ensure all environment variables are set correctly
4. Verify all required services are running

## Security Considerations

### Development
- Use strong JWT secrets
- Enable CORS only for trusted domains
- Validate all input data
- Use HTTPS in production

### Production
- Use environment variables for all secrets
- Enable rate limiting
- Set up proper firewall rules
- Regular security updates
- Monitor for suspicious activities
- Backup data regularly

---

**Congratulations!** 🎉 You now have Ed Share running on your system. The application includes all the requested features and is ready for further customization and deployment.
