import Category from '../model/categories.schema.js';

const categoryData = [
  // Main categories
  { categoryName: 'Sports', parentCategory: null },
  { categoryName: 'Food', parentCategory: null },
  { categoryName: 'Events', parentCategory: null },
  { categoryName: 'Gaming', parentCategory: null },
  
  // Sports subcategories
  { categoryName: 'Indoor Sports', parentCategory: 'Sports' },
  { categoryName: 'Outdoor Sports', parentCategory: 'Sports' },
  
  // Food subcategories
  { categoryName: 'Restaurant', parentCategory: 'Food' },
  { categoryName: 'Street Food', parentCategory: 'Food' },
  
  // Events subcategories
  { categoryName: 'Festival', parentCategory: 'Events' },
  { categoryName: 'Wedding', parentCategory: 'Events' },
  { categoryName: 'Concert', parentCategory: 'Events' },
  { categoryName: 'Education', parentCategory: 'Events' },
  { categoryName: 'Political', parentCategory: 'Events' },
  
  // Gaming subcategories
  { categoryName: 'Console Gaming', parentCategory: 'Gaming' },
  { categoryName: 'PC Gaming', parentCategory: 'Gaming' },
];

const seedCategories = async () => {
  let created = 0;
  let existing = 0;
  const categoryMap = new Map();
  
  try {
    // First, create all main categories (ones with no parent)
    for (const category of categoryData.filter(c => !c.parentCategory)) {
      const [cat, isNew] = await createCategoryIfNotExists(category.categoryName);
      categoryMap.set(category.categoryName, cat._id);
      isNew ? created++ : existing++;
    }
    
    // Then create all subcategories
    for (const category of categoryData.filter(c => c.parentCategory)) {
      const parentId = categoryMap.get(category.parentCategory);
      if (!parentId) {
        console.log(`Parent category ${category.parentCategory} not found for ${category.categoryName}`);
        continue;
      }
      
      const [cat, isNew] = await createCategoryIfNotExists(
        category.categoryName, 
        parentId
      );
      isNew ? created++ : existing++;
    }
    
    console.log(`Categories: ${created} created, ${existing} existing`);
  } catch (error) {
    console.error('Error seeding categories:', error);
  }
};

const createCategoryIfNotExists = async (categoryName, parentCategory = null) => {
  const existingCategory = await Category.findOne({ categoryName });
  if (existingCategory) {
    return [existingCategory, false];
  }
  
  const newCategory = new Category({ 
    categoryName, 
    parentCategory,
    isActive: true
  });
  await newCategory.save();
  return [newCategory, true];
};

export default seedCategories;