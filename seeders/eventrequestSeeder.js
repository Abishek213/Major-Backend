// seeders/eventrequestSeeder.js
import User from '../model/user.schema.js';
import Role from '../model/role.schema.js';
import EventRequest from '../model/eventrequest.schema.js';
import bcryptjs from 'bcryptjs';

/**
 * Seed event requests and additional organizers to ensure AI matching works.
 * Run this once after the initial userSeeder.
 */
const seedEventRequests = async () => {
  console.log('🌱 Starting event request seeder...');

  // ------------------------------------------------------------------------
  // 1. Get required roles and the default user
  // ------------------------------------------------------------------------
  const organizerRole = await Role.findOne({ role_Name: 'Organizer' });
  const userRole = await Role.findOne({ role_Name: 'User' });
  if (!organizerRole || !userRole) {
    console.error('❌ Required roles not found. Run roleSeeder first.');
    return;
  }

  // Default user created by userSeeder
  const defaultUser = await User.findOne({ email: 'user@gmail.com' });
  if (!defaultUser) {
    console.error('❌ Default user (user@gmail.com) not found. Run userSeeder first.');
    return;
  }

  // ------------------------------------------------------------------------
  // 2. Create 5–8 organizers with rich details for AI matching
  // ------------------------------------------------------------------------
  const organizerDetails = [
    {
      fullname: 'Wedding Planners Nepal',
      email: 'wedding@example.com',
      password: 'organizer123',
      contactNo: '9841000001',
      expertise: ['wedding', 'anniversary'],
      serviceAreas: [{ city: 'Kathmandu' }, { city: 'Lalitpur' }],
      pricing: {
        wedding: { min: 200000, max: 1500000 },
        anniversary: { min: 150000, max: 800000 },
      },
      priceRange: { min: 200000, max: 1500000 },
      rating: 4.8,
      totalEvents: 120,
      responseTime: '< 2 hours',
      isVerified: true,
      businessName: 'Wedding Planners Nepal',
      establishedYear: 2015,
    },
    {
      fullname: 'Birthday Bash Experts',
      email: 'birthday@example.com',
      password: 'organizer123',
      contactNo: '9841000002',
      expertise: ['birthday', 'party'],
      serviceAreas: [{ city: 'Kathmandu' }, { city: 'Bhaktapur' }],
      pricing: {
        birthday: { min: 50000, max: 500000 },
        party: { min: 30000, max: 200000 },
      },
      priceRange: { min: 50000, max: 500000 },
      rating: 4.5,
      totalEvents: 85,
      responseTime: '< 4 hours',
      isVerified: true,
      businessName: 'Birthday Bash Experts',
      establishedYear: 2018,
    },
    {
      fullname: 'Corporate Events Ltd.',
      email: 'corporate@example.com',
      password: 'organizer123',
      contactNo: '9841000003',
      expertise: ['corporate', 'conference', 'workshop'],
      serviceAreas: [{ city: 'Kathmandu' }, { city: 'Pokhara' }],
      pricing: {
        corporate: { min: 300000, max: 2000000 },
        conference: { min: 400000, max: 2500000 },
        workshop: { min: 100000, max: 500000 },
      },
      priceRange: { min: 300000, max: 2000000 },
      rating: 4.7,
      totalEvents: 65,
      responseTime: '< 1 hour',
      isVerified: true,
      businessName: 'Corporate Events Ltd.',
      establishedYear: 2013,
    },
    {
      fullname: 'Concert & Music Masters',
      email: 'concert@example.com',
      password: 'organizer123',
      contactNo: '9841000004',
      expertise: ['concert', 'festival'],
      serviceAreas: [{ city: 'Pokhara' }, { city: 'Chitwan' }],
      pricing: {
        concert: { min: 500000, max: 3000000 },
        festival: { min: 300000, max: 2000000 },
      },
      priceRange: { min: 500000, max: 3000000 },
      rating: 4.9,
      totalEvents: 40,
      responseTime: '< 3 hours',
      isVerified: true,
      businessName: 'Concert & Music Masters',
      establishedYear: 2019,
    },
    {
      fullname: 'Pokhara Event Hub',
      email: 'pokhara@example.com',
      password: 'organizer123',
      contactNo: '9841000005',
      expertise: ['wedding', 'birthday', 'festival'],
      // FIXED: Changed 'Baglung' to 'Pokhara' (allowed value)
      serviceAreas: [{ city: 'Pokhara' }, { city: 'Pokhara' }],
      pricing: {
        wedding: { min: 100000, max: 800000 },
        birthday: { min: 50000, max: 300000 },
        festival: { min: 200000, max: 1000000 },
      },
      priceRange: { min: 100000, max: 800000 },
      rating: 4.4,
      totalEvents: 55,
      responseTime: '< 6 hours',
      isVerified: false,
      businessName: 'Pokhara Event Hub',
      establishedYear: 2020,
    },
    {
      fullname: 'Lalitpur Celebrations',
      email: 'lalitpur@example.com',
      password: 'organizer123',
      contactNo: '9841000006',
      expertise: ['wedding', 'birthday', 'anniversary'],
      serviceAreas: [{ city: 'Lalitpur' }, { city: 'Bhaktapur' }],
      pricing: {
        wedding: { min: 150000, max: 1000000 },
        birthday: { min: 40000, max: 250000 },
        anniversary: { min: 80000, max: 400000 },
      },
      priceRange: { min: 150000, max: 1000000 },
      rating: 4.6,
      totalEvents: 70,
      responseTime: '< 2 hours',
      isVerified: true,
      businessName: 'Lalitpur Celebrations',
      establishedYear: 2016,
    },
    {
      fullname: 'Tech Conference Specialists',
      email: 'techconf@example.com',
      password: 'organizer123',
      contactNo: '9841000007',
      expertise: ['conference', 'workshop'],
      serviceAreas: [{ city: 'Kathmandu' }, { city: 'Kathmandu' }], // FIXED: 'Online' replaced with 'Kathmandu'
      pricing: {
        conference: { min: 400000, max: 2500000 },
        workshop: { min: 80000, max: 400000 },
      },
      priceRange: { min: 400000, max: 2500000 },
      rating: 4.8,
      totalEvents: 30,
      responseTime: '< 1 hour',
      isVerified: true,
      businessName: 'Tech Conference Specialists',
      establishedYear: 2021,
    },
    {
      fullname: 'Chitwan Events',
      email: 'chitwan@example.com',
      password: 'organizer123',
      contactNo: '9841000008',
      expertise: ['festival', 'wedding'],
      // FIXED: Changed 'Nawalpur' to 'Chitwan' (allowed value)
      serviceAreas: [{ city: 'Chitwan' }, { city: 'Chitwan' }],
      pricing: {
        festival: { min: 80000, max: 600000 },
        wedding: { min: 150000, max: 700000 },
      },
      priceRange: { min: 80000, max: 600000 },
      rating: 4.3,
      totalEvents: 45,
      responseTime: '< 5 hours',
      isVerified: false,
      businessName: 'Chitwan Events',
      establishedYear: 2022,
    },
  ];

  let createdOrganizers = 0;
  for (const orgData of organizerDetails) {
    const existing = await User.findOne({ email: orgData.email });
    if (!existing) {
      const hashedPassword = await bcryptjs.hash(orgData.password, 10);
      await User.create({
        fullname: orgData.fullname,
        email: orgData.email,
        password: hashedPassword,
        contactNo: orgData.contactNo,
        role: organizerRole._id,
        organizerDetails: {
          businessName: orgData.businessName,
          contactPerson: orgData.fullname,
          contactPhone: orgData.contactNo,
          establishedYear: orgData.establishedYear,
          expertise: orgData.expertise,
          serviceAreas: orgData.serviceAreas,
          pricing: orgData.pricing,
          priceRange: orgData.priceRange,
          rating: orgData.rating,
          totalEvents: orgData.totalEvents,
          responseTime: orgData.responseTime,
          isVerified: orgData.isVerified,
        },
      });
      createdOrganizers++;
    }
  }
  console.log(`✅ Created ${createdOrganizers} new organizers.`);

  // ------------------------------------------------------------------------
  // 3. Create sample event requests for the default user
  // ------------------------------------------------------------------------
  const eventRequests = [
    {
      eventType: 'Wedding',
      venue: 'Kathmandu',
      budget: 900000,
      date: new Date('2026-12-15'),
      description: 'I want a wedding in Kathmandu for 100 people with 9 lakh budget',
      status: 'open',
      userId: defaultUser._id,
    },
    {
      eventType: 'Birthday',
      venue: 'Pokhara',
      budget: 250000,
      date: new Date('2026-11-20'),
      description: 'Surprise birthday party for my wife, around 50 guests, budget 2.5 lakh',
      status: 'open',
      userId: defaultUser._id,
    },
    {
      eventType: 'Conference',
      venue: 'Kathmandu',
      budget: 1500000,
      date: new Date('2026-10-05'),
      description: 'Tech conference with 200 attendees, need venue and catering',
      status: 'open',
      userId: defaultUser._id,
    },
    {
      eventType: 'Corporate',
      venue: 'Lalitpur',
      budget: 500000,
      date: new Date('2026-09-18'),
      description: 'Annual company meeting for 80 employees, half-day event',
      status: 'open',
      userId: defaultUser._id,
    },
    {
      eventType: 'Concert',
      venue: 'Pokhara',
      budget: 1200000,
      date: new Date('2026-08-30'),
      description: 'Live concert for 500 people, need sound system and security',
      status: 'open',
      userId: defaultUser._id,
    },
  ];

  let createdRequests = 0;
  for (const reqData of eventRequests) {
    const existing = await EventRequest.findOne({
      userId: defaultUser._id,
      description: reqData.description,
    });
    if (!existing) {
      await EventRequest.create(reqData);
      createdRequests++;
    }
  }
  console.log(`✅ Created ${createdRequests} sample event requests.`);

  console.log('🎉 Event request seeding completed.');
};

export default seedEventRequests;