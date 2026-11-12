import React, { useState, useEffect } from 'react';
import Card from '@/components/common/Card';
import Button from '@/components/common/Button';
import { educationService } from '@/services/educationService';
import { BookOpenIcon, PlayIcon, FireIcon } from '@heroicons/react/24/solid';

const EducationHub: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'course' | 'news'>('course');
    const [activeLevel, setActiveLevel] = useState('Level 1');
    const [resources, setResources] = useState<any[]>([]);
    const [loading, setLoading] = useState(false);

    // Data loading function
    const loadData = async () => {
        setLoading(true);
        try {
            // Filter by type='News' if news tab, or level if course tab
            const type = activeTab === 'news' ? 'News' : undefined;
            const level = activeTab === 'course' ? activeLevel : undefined;

            const data = await educationService.getAllResources(level, type);
            setResources(data);
        } catch (e) { console.error(e); }
        finally { setLoading(false); }
    };

    useEffect(() => { loadData(); }, [activeTab, activeLevel]);

    const levels = ['Level 1', 'Level 2', 'Level 3', 'Level 4', 'Level 5'];

    return (
        <div className="space-y-8 pb-10">
            {/* Header */}
            <div className="text-center py-10 bg-gradient-to-r from-blue-50 via-slate-100 to-indigo-50 dark:from-slate-900 dark:via-slate-900 dark:to-slate-950 rounded-3xl relative overflow-hidden border border-slate-200 dark:border-white/5 shadow-sm">
                <div className="absolute inset-0 bg-blue-500/10 animate-pulse pointer-events-none"></div>
                <h1 className="text-4xl font-extrabold text-slate-900 dark:text-white relative z-10">Cosmo Academy</h1>
                <p className="text-slate-600 dark:text-gray-400 mt-2 relative z-10">Master Crypto Trading: Zero to Hero</p>
            </div>

            {/* Tabs */}
            <div className="flex justify-center gap-4">
                <Button
                    variant={activeTab === 'course' ? 'primary' : 'secondary'}
                    onClick={() => setActiveTab('course')}
                >
                    🎓 Full Course
                </Button>
                <Button
                    variant={activeTab === 'news' ? 'primary' : 'secondary'}
                    onClick={() => setActiveTab('news')}
                >
                    📰 Latest News
                </Button>
            </div>

            {/* Course Levels (Only show if Course tab is active) */}
            {activeTab === 'course' && (
                <div className="flex overflow-x-auto gap-2 pb-4 justify-center">
                    {levels.map(lvl => (
                        <button
                            key={lvl}
                            onClick={() => setActiveLevel(lvl)}
                            className={`px-4 py-2 rounded-full text-sm font-bold transition-all ${activeLevel === lvl
                                    ? 'bg-blue-600 text-white shadow-lg shadow-blue-500/25 scale-105'
                                    : 'bg-slate-100 hover:bg-slate-200 dark:bg-gray-800 dark:hover:bg-gray-700 text-slate-700 dark:text-gray-300 border border-slate-200 dark:border-transparent'
                                }`}
                        >
                            {lvl}
                        </button>
                    ))}
                </div>
            )}

            {/* Content Grid */}
            <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-6">
                {loading ? (
                    <p className="text-center col-span-full text-slate-500 dark:text-gray-400">Loading knowledge...</p>
                ) : resources.length > 0 ? (
                    resources.map((res) => (
                        <Card key={res.id} className="hover:shadow-xl transition-all border-l-4 border-l-blue-500 bg-white dark:bg-[#0A0A0A] border-slate-200 dark:border-[#1A1A1A]">
                            <div className="flex justify-between items-start mb-3">
                                <span className="text-xs font-bold bg-blue-50 dark:bg-blue-500/10 text-blue-600 dark:text-blue-400 border border-blue-200 dark:border-blue-500/20 px-2.5 py-1 rounded-md">
                                    {res.category}
                                </span>
                                {res.type === 'News' && <FireIcon className="h-5 w-5 text-orange-500" />}
                            </div>
                            <h3 className="font-bold text-lg mb-2 line-clamp-2 text-slate-900 dark:text-white">{res.title}</h3>
                            <p className="text-sm text-slate-600 dark:text-gray-400 mb-4 line-clamp-3">{res.description}</p>
                            <a
                                href={res.link}
                                target="_blank"
                                rel="noopener noreferrer"
                                className="text-blue-600 dark:text-blue-400 hover:text-blue-700 dark:hover:text-blue-300 text-sm font-bold hover:underline flex items-center gap-1"
                            >
                                {res.type === 'Course' ? 'Start Lesson' : 'Read Article'} <PlayIcon className="h-4 w-4" />
                            </a>
                        </Card>
                    ))
                ) : (
                    <div className="col-span-full text-center py-10 bg-slate-50 dark:bg-white/5 rounded-2xl border border-dashed border-slate-300 dark:border-white/10">
                        <BookOpenIcon className="h-10 w-10 text-slate-400 dark:text-gray-500 mx-auto mb-2" />
                        <p className="text-slate-600 dark:text-gray-400">No content found. Please run the initialization script.</p>
                    </div>
                )}
            </div>
        </div>
    );
};

export default EducationHub;