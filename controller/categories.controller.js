import Category from "../model/categories.schema.js";

// Get all categories
export const getCategories = async (req, res) => {
  try {
    const categories = await Category.find()
      .populate('parentCategory', 'categoryName');  // This will populate parent category details
    res.status(200).json(categories);
  } catch (error) {
    res.status(500).json({ message: "Error fetching categories", error });
  }
};

// Create a new category
export const createCategory = async (req, res) => {
  const { categoryName, parentCategory } = req.body;

  if (!categoryName) {
    return res.status(400).json({ message: "Category name is required" });
  }

  try {
    const category = new Category({ 
      categoryName, 
      parentCategory: parentCategory || null 
    });
    await category.save();
    res.status(201).json(category);
  } catch (error) {
    if (error.code === 11000) {
      res.status(400).json({ message: "Category name must be unique" });
    } else {
      res.status(500).json({ message: "Error creating category", error });
    }
  }
};

// Soft delete (deactivate) a category
export const deactivateCategory = async (req, res) => {
  const { id } = req.params;
  console.log('Deactivate request received for id:', id);

  try {
    if (!mongoose.Types.ObjectId.isValid(id)) {
      console.log('Invalid ID format:', id);
      return res.status(400).json({
        message: "Invalid category ID format"
      });
    }

    const category = await Category.findByIdAndUpdate(
      id,
      { isActive: false },
      { 
        new: true,
        runValidators: true 
      }
    ).populate('parentCategory', 'categoryName');
    
    console.log('Found category:', category);
    
    if (!category) {
      console.log('Category not found for id:', id);
      return res.status(404).json({ 
        message: "Category not found"
      });
    }
    
    // Ensure we're sending a JSON object, not null
    const response = {
      ...category.toObject(),
      message: "Category deactivated successfully"
    };
    
    console.log('Sending response:', response);
    return res.status(200).json(response);
    
  } catch (error) {
    console.error('Deactivation error:', error);
    return res.status(500).json({ 
      message: "Error deactivating category",
      error: error.message 
    });
  }
};

// Reactivate a category
export const reactivateCategory = async (req, res) => {
  const { id } = req.params;

  try {
    const category = await Category.findByIdAndUpdate(
      id,
      { isActive: true },
      { new: true }
    );
    if (!category) {
      return res.status(404).json({ message: "Category not found" });
    }
    res.status(200).json({ message: "Category reactivated successfully", category });
  } catch (error) {
    res.status(500).json({ message: "Error reactivating category", error });
  }
};