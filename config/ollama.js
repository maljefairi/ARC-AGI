const SUPPORTED_MODELS = {
    llava: {
        name: 'llava',
        description: 'Multimodal model supporting both vision and language tasks',
        capabilities: ['vision', 'reasoning'],
        contextWindow: 4096
    },
    codellama: {
        name: 'codellama',
        description: 'Specialized for code understanding and generation',
        capabilities: ['reasoning', 'code'],
        contextWindow: 4096
    }
};

module.exports = {
    SUPPORTED_MODELS,
    DEFAULT_MODEL: 'llava'
}; 