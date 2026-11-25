import React, { useState, useMemo, useEffect } from 'react';
import { MOCK_BLOG_POSTS, MOCK_STRATEGY_OF_THE_WEEK, StrategyIcon, TutorialIcon, AnalysisIcon, AiMlIcon } from '@/constants';
import type { BlogPost } from '@/types';
import type { LegalDocType } from './LegalPage';
import { isThermalGuardActive } from '@/utils/deviceProfile';
import { ArrowRight, X, Clock, BookOpen, CheckCircle2, Play } from 'lucide-react';

type Category = 'All' | 'Strategies' | 'Tutorials' | 'Market Analysis' | 'AI & ML';

interface BlogPageProps {
    onSignUp?: () => void;
    onOpenLegal?: (doc: LegalDocType) => void;
}

const categoryIcons: Record<Category, React.ReactNode> = {
    All: <></>,
    Strategies: <StrategyIcon />,
    Tutorials: <TutorialIcon />,
    'Market Analysis': <AnalysisIcon />,
    'AI & ML': <AiMlIcon />,
};

const BlogCard: React.FC<{
    post: BlogPost;
    featured?: boolean;
    thermalGuard: boolean;
    onRead: (post: BlogPost) => void;
}> = ({ post, featured, thermalGuard, onRead }) => (
    <article
        onClick={() => onRead(post)}
        className={`group cursor-pointer relative flex flex-col overflow-hidden rounded-3xl bg-[#070F20]/70 ${thermalGuard ? '' : 'backdrop-blur-xl'} border border-white/10 shadow-[0_0_20px_rgba(6,182,212,0.05)] hover:shadow-[0_0_30px_rgba(6,182,212,0.18)] hover:border-cyan-500/35 transition-all duration-500 hover:-translate-y-1.5 ${featured ? 'md:flex-row md:col-span-2 md:min-h-[22rem]' : 'h-full'}`}
    >
        <div className={`relative overflow-hidden ${featured ? 'md:w-1/2 h-56 md:h-auto border-b md:border-b-0 md:border-r border-white/10' : 'h-48 border-b border-white/10'}`}>
            <img
                src={post.imageUrl}
                alt={post.title}
                className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-700"
            />
            <span className="absolute top-4 left-4 z-20 text-[10px] font-bold uppercase tracking-widest bg-[#020610]/85 px-3 py-1 rounded-full text-cyan-300 border border-cyan-500/25">
                {post.category}
            </span>
        </div>

        <div className={`p-7 flex flex-col flex-grow relative z-10 ${featured ? 'md:w-1/2 justify-center' : ''}`}>
            <div className="flex flex-wrap items-center gap-2.5 text-xs text-slate-400 font-mono mb-3.5">
                <span className="flex items-center gap-2">
                    <div className="w-6 h-6 rounded-full bg-gradient-to-br from-cyan-500 to-violet-600 flex items-center justify-center text-[10px] text-white font-bold">
                        {post.author[0]}
                    </div>
                    <span className="text-slate-200">{post.author}</span>
                </span>
                <span className="text-cyan-500/50">•</span>
                <span>{post.date}</span>
                {post.readTime && (
                    <>
                        <span className="text-cyan-500/50">•</span>
                        <span>{post.readTime}</span>
                    </>
                )}
            </div>

            <h3 className={`${featured ? 'text-2xl sm:text-3xl' : 'text-xl'} font-bold text-white mb-3 group-hover:text-cyan-300 transition-colors leading-tight`}>
                {post.title}
            </h3>

            <p className="text-slate-400 text-sm mb-6 line-clamp-3 leading-relaxed font-light">
                {post.excerpt}
            </p>

            <div className="mt-auto pt-4 border-t border-white/10">
                <span className="text-sm font-bold text-cyan-400 group-hover:text-cyan-300 inline-flex items-center gap-1.5 transition-all">
                    Read Article
                    <ArrowRight className="w-4 h-4 transition-transform group-hover:translate-x-1" />
                </span>
            </div>
        </div>
    </article>
);

const NewsletterSection: React.FC<{
    thermalGuard: boolean;
    onOpenLegal?: (doc: LegalDocType) => void;
}> = ({ thermalGuard, onOpenLegal }) => {
    const [email, setEmail] = useState('');
    const [status, setStatus] = useState<{ ok: boolean; msg: string } | null>(null);

    const handleSubmit = (e: React.FormEvent) => {
        e.preventDefault();
        if (!email.includes('@')) {
            setStatus({ ok: false, msg: 'Please enter a valid email address.' });
            return;
        }
        setStatus({ ok: true, msg: 'Subscribed! Weekly quant research dispatches are enabled.' });
        setEmail('');
    };

    return (
        <div className={`relative my-16 rounded-[2rem] overflow-hidden bg-[#070F20]/85 border border-violet-500/25 px-6 py-10 sm:px-12 sm:py-14 lg:flex lg:items-center lg:p-16 shadow-[0_0_50px_rgba(139,92,246,0.12)] ${thermalGuard ? '' : 'backdrop-blur-2xl'}`}>
            <div className="lg:w-1/2 lg:pr-12 relative z-10">
                <h2 className="text-3xl font-extrabold tracking-tight text-white mb-3">
                    Weekly <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 to-violet-400">Quant Research</span> in Your Inbox
                </h2>
                <p className="text-base sm:text-lg text-slate-400 leading-relaxed font-light">
                    Receive breakdowns of order-book liquidity regimes, Smart Chase execution tactics, and reproducible strategy templates from CosmoQuantAI Research.
                </p>
            </div>
            <div className="mt-8 lg:mt-0 lg:w-1/2 relative z-10">
                <form onSubmit={handleSubmit} className="sm:flex gap-3">
                    <input
                        type="email"
                        value={email}
                        onChange={(e) => setEmail(e.target.value)}
                        className="w-full rounded-xl border border-white/15 bg-[#020610]/90 px-4 py-3.5 text-white placeholder-slate-500 focus:border-cyan-500 focus:outline-none text-sm"
                        placeholder="you@domain.com"
                    />
                    <div className="mt-3 sm:mt-0">
                        <button
                            type="submit"
                            className="w-full rounded-xl font-bold bg-gradient-to-r from-cyan-500 to-violet-600 text-white shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_30px_rgba(6,182,212,0.5)] transition-all hover:scale-[1.02] py-3.5 px-7 whitespace-nowrap"
                        >
                            Subscribe Free
                        </button>
                    </div>
                </form>
                {status && (
                    <p className={`mt-3 text-xs font-medium flex items-center gap-1.5 ${status.ok ? 'text-emerald-400' : 'text-rose-400'}`}>
                        {status.ok && <CheckCircle2 className="w-3.5 h-3.5" />}
                        {status.msg}
                    </p>
                )}
                <p className="mt-3 text-xs text-slate-500">
                    No spam. Review our{' '}
                    <button
                        type="button"
                        onClick={() => onOpenLegal?.('privacy')}
                        className="text-cyan-400 hover:text-cyan-300 underline transition-colors"
                    >
                        Privacy Policy
                    </button>
                    .
                </p>
            </div>
        </div>
    );
};

const BlogPage: React.FC<BlogPageProps> = ({ onSignUp, onOpenLegal }) => {
    const [activeCategory, setActiveCategory] = useState<Category>('All');
    const [selectedPost, setSelectedPost] = useState<BlogPost | null>(null);
    const [strategyPreviewOpen, setStrategyPreviewOpen] = useState(false);
    const thermalGuard = isThermalGuardActive();

    const heroPost = useMemo(() => MOCK_BLOG_POSTS.find((p) => p.isFeatured), []);

    const filteredPosts = useMemo(() => {
        let posts = MOCK_BLOG_POSTS;
        if (activeCategory !== 'All') {
            posts = posts.filter((p) => p.category === activeCategory);
        }
        if (activeCategory === 'All' && heroPost) {
            return posts.filter((p) => p.id !== heroPost.id);
        }
        return posts;
    }, [activeCategory, heroPost]);

    useEffect(() => {
        if (!selectedPost && !strategyPreviewOpen) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') {
                setSelectedPost(null);
                setStrategyPreviewOpen(false);
            }
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [selectedPost, strategyPreviewOpen]);

    const categories: Category[] = ['All', 'Strategies', 'Tutorials', 'Market Analysis', 'AI & ML'];

    return (
        <div className="bg-transparent min-h-screen selection:bg-cyan-500/30 selection:text-cyan-200">
            {/* Header Section */}
            <div className="relative pt-24 pb-20 overflow-hidden">
                <div className="absolute inset-0 z-0 pointer-events-none">
                    <div
                        className="absolute inset-0 opacity-10"
                        style={{
                            backgroundImage: 'linear-gradient(rgba(139,92,246,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(139,92,246,0.15) 1px, transparent 1px)',
                            backgroundSize: '40px 40px',
                        }}
                    />
                    {!thermalGuard && (
                        <>
                            <div className="absolute top-16 left-1/4 w-[460px] h-[460px] bg-violet-600/10 rounded-full blur-[120px] animate-float-medium" />
                            <div className="absolute top-36 right-1/4 w-[380px] h-[380px] bg-pink-600/10 rounded-full blur-[100px] animate-float-slow" />
                        </>
                    )}
                </div>

                <div className="container mx-auto px-4 relative z-10 text-center">
                    <span className="inline-flex items-center gap-2 py-1 px-3.5 rounded-full bg-violet-500/10 text-violet-300 text-xs font-bold tracking-widest uppercase mb-6 border border-violet-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-violet-400 animate-pulse" />
                        Quant Research &amp; Playbooks
                    </span>
                    <h1 className="text-4xl sm:text-5xl md:text-7xl font-extrabold text-white tracking-tight mb-5">
                        The CosmoQuant <span className="text-transparent bg-clip-text bg-gradient-to-r from-violet-400 via-pink-400 to-cyan-400">Journal</span>
                    </h1>
                    <p className="text-lg sm:text-xl text-slate-400 font-light max-w-2xl mx-auto">
                        Practical playbooks on algorithmic execution, order-book heatmap telemetry, and systematic risk engineering.
                    </p>
                </div>
            </div>

            <div className="container mx-auto px-4 sm:px-6 lg:px-8 relative z-20 pb-20">
                {/* Category Navigation */}
                <div className="flex justify-center mb-12">
                    <div className={`inline-flex p-1.5 bg-[#0D1117]/85 ${thermalGuard ? '' : 'backdrop-blur-xl'} border border-white/10 rounded-2xl overflow-x-auto max-w-full`}>
                        {categories.map((category) => (
                            <button
                                key={category}
                                type="button"
                                onClick={() => setActiveCategory(category)}
                                className={`px-5 py-2.5 rounded-xl text-sm font-bold transition-all duration-300 whitespace-nowrap flex items-center gap-2 ${activeCategory === category
                                    ? 'bg-gradient-to-r from-violet-600/25 to-cyan-600/20 text-white border border-violet-500/40'
                                    : 'text-slate-400 border border-transparent hover:bg-white/5 hover:text-white'
                                    }`}
                            >
                                <span className={activeCategory === category ? 'text-violet-300' : 'opacity-70'}>
                                    {categoryIcons[category]}
                                </span>
                                {category}
                            </button>
                        ))}
                    </div>
                </div>

                {/* Hero Article */}
                {activeCategory === 'All' && heroPost && (
                    <div className="mb-12">
                        <BlogCard post={heroPost} featured={true} thermalGuard={thermalGuard} onRead={setSelectedPost} />
                    </div>
                )}

                {/* Strategy of the Week */}
                <section className="mb-16">
                    <div className={`rounded-[2rem] bg-[#070F20]/85 ${thermalGuard ? '' : 'backdrop-blur-xl'} border border-cyan-500/25 shadow-[0_0_40px_rgba(6,182,212,0.1)] overflow-hidden relative`}>
                        <div className="grid md:grid-cols-2 relative z-10">
                            <div className="p-8 md:p-11 flex flex-col justify-center border-b md:border-b-0 md:border-r border-white/10">
                                <div className="flex items-center gap-2 mb-5">
                                    <div className="h-2 w-2 rounded-full bg-cyan-400 animate-pulse" />
                                    <span className="text-[10px] font-bold uppercase tracking-widest text-cyan-300 border border-cyan-500/30 px-2.5 py-0.5 rounded-full">
                                        Strategy of the Week
                                    </span>
                                </div>
                                <h2 className="text-2xl sm:text-3xl font-extrabold text-white mb-3 tracking-tight">
                                    {MOCK_STRATEGY_OF_THE_WEEK.title}
                                </h2>
                                <p className="text-slate-400 text-sm sm:text-base mb-8 leading-relaxed font-light">
                                    {MOCK_STRATEGY_OF_THE_WEEK.description}
                                </p>

                                <div className="flex gap-5">
                                    <div className="bg-[#020610]/70 p-4 rounded-2xl border border-white/10 flex-1 text-center">
                                        <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-1 font-bold">Sim Net Return</p>
                                        <p className="text-2xl font-mono font-bold text-emerald-400 drop-shadow-[0_0_6px_rgba(52,211,153,0.45)]">
                                            +{MOCK_STRATEGY_OF_THE_WEEK.results.profit}%
                                        </p>
                                    </div>
                                    <div className="bg-[#020610]/70 p-4 rounded-2xl border border-white/10 flex-1 text-center">
                                        <p className="text-[10px] text-slate-400 uppercase tracking-widest mb-1 font-bold">Max Drawdown</p>
                                        <p className="text-2xl font-mono font-bold text-rose-400 drop-shadow-[0_0_6px_rgba(244,63,94,0.45)]">
                                            -{MOCK_STRATEGY_OF_THE_WEEK.results.drawdown}%
                                        </p>
                                    </div>
                                </div>
                            </div>

                            <div className="p-7 sm:p-8 bg-[#020610]/80 flex flex-col">
                                <div className="flex items-center justify-between text-slate-400 text-xs font-mono mb-3 px-1 border-b border-white/10 pb-2.5">
                                    <span>ai_foundry_prompt.txt</span>
                                    <div className="flex gap-1.5">
                                        <div className="w-2.5 h-2.5 rounded-full bg-rose-500/70" />
                                        <div className="w-2.5 h-2.5 rounded-full bg-amber-500/70" />
                                        <div className="w-2.5 h-2.5 rounded-full bg-emerald-500/70" />
                                    </div>
                                </div>
                                <div className="flex-grow bg-[#0D1117] rounded-xl p-5 border border-white/10 font-mono text-sm text-slate-300 relative">
                                    <div className="absolute top-0 left-0 w-1 h-full bg-gradient-to-b from-cyan-500 to-violet-500 rounded-l-xl" />
                                    <div className="pl-3">
                                        <span className="text-violet-400 font-bold">Prompt:</span>
                                        <br />
                                        <span className="text-slate-300 leading-relaxed block mt-1.5">{MOCK_STRATEGY_OF_THE_WEEK.aiPrompt}</span>
                                    </div>
                                </div>
                                <div className="mt-5 flex flex-wrap justify-end gap-3">
                                    <button
                                        type="button"
                                        onClick={() => setStrategyPreviewOpen(true)}
                                        className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider px-5 py-3 rounded-xl border border-cyan-500/35 text-cyan-300 hover:bg-cyan-500/10 transition-all"
                                    >
                                        <Play className="w-3.5 h-3.5" />
                                        Preview Logic
                                    </button>
                                    <button
                                        type="button"
                                        onClick={onSignUp}
                                        className="inline-flex items-center gap-2 text-xs font-bold uppercase tracking-wider px-5 py-3 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-white hover:scale-[1.02] transition-all"
                                    >
                                        Run in AI Foundry
                                        <ArrowRight className="w-3.5 h-3.5" />
                                    </button>
                                </div>
                            </div>
                        </div>
                    </div>
                </section>

                {/* Main Grid */}
                <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-7 mb-16">
                    {filteredPosts.map((post) => (
                        <BlogCard key={post.id} post={post} thermalGuard={thermalGuard} onRead={setSelectedPost} />
                    ))}
                </div>

                <NewsletterSection thermalGuard={thermalGuard} onOpenLegal={onOpenLegal} />
            </div>

            {/* Article Reader Modal */}
            {selectedPost && (
                <div
                    className={`fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 ${thermalGuard ? '' : 'backdrop-blur-md'}`}
                    onClick={() => setSelectedPost(null)}
                >
                    <div
                        className="relative w-full max-w-2xl rounded-3xl bg-[#070F20] border border-cyan-500/25 shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="h-1 bg-gradient-to-r from-violet-500 via-cyan-500 to-emerald-400" />
                        <button
                            type="button"
                            onClick={() => setSelectedPost(null)}
                            aria-label="Close article"
                            className="absolute top-4 right-4 z-20 w-9 h-9 rounded-xl bg-black/60 border border-white/15 text-slate-300 hover:text-white flex items-center justify-center"
                        >
                            <X className="w-4 h-4" />
                        </button>

                        <div className="h-52 relative border-b border-white/10">
                            <img src={selectedPost.imageUrl} alt={selectedPost.title} className="w-full h-full object-cover" />
                            <span className="absolute bottom-4 left-6 px-3 py-1 rounded-full bg-[#020610]/90 border border-cyan-500/30 text-xs font-bold text-cyan-300">
                                {selectedPost.category}
                            </span>
                        </div>

                        <div className="p-6 sm:p-8 space-y-5">
                            <div className="flex flex-wrap items-center gap-3 text-xs font-mono text-slate-400">
                                <span className="text-slate-200 font-semibold">{selectedPost.author}</span>
                                <span>•</span>
                                <span>{selectedPost.date}</span>
                                {selectedPost.readTime && (
                                    <>
                                        <span>•</span>
                                        <span className="inline-flex items-center gap-1"><Clock className="w-3.5 h-3.5 text-cyan-400" /> {selectedPost.readTime}</span>
                                    </>
                                )}
                            </div>

                            <h2 className="text-2xl sm:text-3xl font-extrabold text-white leading-tight">{selectedPost.title}</h2>

                            <div className="space-y-4 text-sm sm:text-base text-slate-300 leading-relaxed">
                                {(selectedPost.content && selectedPost.content.length > 0
                                    ? selectedPost.content
                                    : [selectedPost.excerpt]
                                ).map((paragraph, idx) => (
                                    <p key={idx}>{paragraph}</p>
                                ))}
                            </div>

                            {selectedPost.tags && (
                                <div className="flex flex-wrap gap-2 pt-2">
                                    {selectedPost.tags.map((tag) => (
                                        <span key={tag} className="px-2.5 py-1 rounded-lg bg-white/5 border border-white/10 text-xs font-mono text-cyan-300">
                                            #{tag}
                                        </span>
                                    ))}
                                </div>
                            )}

                            <div className="pt-4 border-t border-white/10 flex flex-col sm:flex-row gap-3 justify-between items-center">
                                <span className="text-xs text-slate-400 inline-flex items-center gap-1.5">
                                    <BookOpen className="w-4 h-4 text-cyan-400" /> Ready to test these concepts live?
                                </span>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSelectedPost(null);
                                        onSignUp?.();
                                    }}
                                    className="w-full sm:w-auto px-6 py-2.5 rounded-xl font-bold text-sm bg-gradient-to-r from-cyan-500 to-violet-600 text-white"
                                >
                                    Open Free Terminal
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}

            {/* Strategy Preview Modal */}
            {strategyPreviewOpen && (
                <div
                    className={`fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/80 ${thermalGuard ? '' : 'backdrop-blur-md'}`}
                    onClick={() => setStrategyPreviewOpen(false)}
                >
                    <div
                        className="relative w-full max-w-xl rounded-3xl bg-[#070F20] border border-cyan-500/30 shadow-2xl p-6 sm:p-8"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <button
                            type="button"
                            onClick={() => setStrategyPreviewOpen(false)}
                            aria-label="Close strategy preview"
                            className="absolute top-4 right-4 w-9 h-9 rounded-xl bg-white/5 border border-white/10 text-slate-300 hover:text-white flex items-center justify-center"
                        >
                            <X className="w-4 h-4" />
                        </button>
                        <span className="text-[11px] font-bold uppercase tracking-widest text-cyan-400">Compiled Strategy Blueprint</span>
                        <h3 className="text-2xl font-extrabold text-white mt-1 mb-4">{MOCK_STRATEGY_OF_THE_WEEK.title}</h3>
                        <pre className="bg-[#0D1117] border border-white/10 rounded-2xl p-4 text-xs font-mono text-slate-200 overflow-x-auto leading-relaxed mb-5">
{`class WallHunterBollingerReversion(CosmoStrategy):
    timeframe = "1h"
    bb_period, bb_std = 20, 2.0
    use_smart_chase_sl = True

    def on_bar(self, bar, orderbook):
        upper, mid, lower = self.bollinger(bar.close)
        if bar.high > upper and orderbook.ask_wall_absorbed():
            self.enter_short(tp=mid, chase_sl_atr=1.4)
        elif bar.low < lower and orderbook.bid_wall_held():
            self.enter_long(tp=mid, chase_sl_atr=1.4)`}
                        </pre>
                        <div className="flex justify-end gap-3">
                            <button
                                type="button"
                                onClick={() => setStrategyPreviewOpen(false)}
                                className="px-4 py-2.5 rounded-xl bg-white/5 border border-white/10 text-xs font-semibold text-slate-300"
                            >
                                Close
                            </button>
                            <button
                                type="button"
                                onClick={() => {
                                    setStrategyPreviewOpen(false);
                                    onSignUp?.();
                                }}
                                className="px-5 py-2.5 rounded-xl bg-gradient-to-r from-cyan-500 to-violet-600 text-xs font-bold text-white"
                            >
                                Clone to My Workspace
                            </button>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default BlogPage;
