import React, { useState, useEffect } from 'react';
import { MOCK_PORTFOLIO_PROJECTS, MOCK_CLIENT_TESTIMONIALS } from '@/constants';
import type { PortfolioProject } from '@/types';
import { isThermalGuardActive } from '@/utils/deviceProfile';
import type { BriefingTopic } from './PublicBriefingModal';
import { ArrowRight, X, CheckCircle2, Layers, Cpu, Calendar } from 'lucide-react';

interface PortfolioPageProps {
    onSignUp: () => void;
    onOpenBriefing?: (topic?: BriefingTopic) => void;
}

const MetricBadge: React.FC<{ label: string; value: string }> = ({ label, value }) => (
    <div className="flex flex-col bg-white/5 border border-white/10 rounded-xl p-2.5 text-center">
        <span className="text-[10px] uppercase tracking-wider text-slate-400 truncate">{label}</span>
        <span className="text-sm font-bold text-cyan-400 mt-0.5">{value}</span>
    </div>
);

const ProjectCard: React.FC<{
    project: PortfolioProject;
    index: number;
    thermalGuard: boolean;
    onInspect: (project: PortfolioProject) => void;
}> = ({ project, index, thermalGuard, onInspect }) => (
    <div
        onClick={() => onInspect(project)}
        className={`group cursor-pointer relative bg-[#070F20]/70 ${thermalGuard ? '' : 'backdrop-blur-xl'} border border-white/10 shadow-[0_0_20px_rgba(6,182,212,0.05)] rounded-3xl overflow-hidden hover:shadow-[0_0_30px_rgba(6,182,212,0.2)] hover:border-cyan-500/35 transition-all duration-500 hover:-translate-y-1.5 flex flex-col h-full`}
        style={{ animationDelay: `${index * 100}ms` }}
    >
        <div className="relative h-52 overflow-hidden border-b border-white/10">
            <div className="absolute inset-0 bg-[#020610]/30 group-hover:bg-transparent transition-colors duration-500 z-10" />
            <img
                src={project.imageUrl}
                alt={project.title}
                className="w-full h-full object-cover transform group-hover:scale-105 transition-transform duration-700"
            />
            <div className="absolute top-4 left-4 z-20">
                <span className="px-3 py-1 text-xs font-bold bg-[#020610]/85 border border-cyan-500/25 rounded-full text-cyan-300">
                    {project.category}
                </span>
            </div>
        </div>

        <div className="p-6 md:p-7 flex flex-col flex-grow relative">
            <h3 className="text-xl font-bold text-white mb-2.5 group-hover:text-cyan-300 transition-colors">
                {project.title}
            </h3>

            <p className="text-sm text-slate-400 leading-relaxed mb-6 flex-grow">
                {project.description}
            </p>

            <div className="grid grid-cols-3 gap-2 mb-6">
                {project.metrics.map((metric, idx) => (
                    <MetricBadge key={idx} label={metric.label} value={metric.value} />
                ))}
            </div>

            <div className="pt-4 border-t border-white/10 flex justify-between items-center mt-auto">
                <div className="flex flex-wrap gap-2">
                    {project.tags.slice(0, 3).map((tag) => (
                        <span key={tag} className="text-[10px] font-mono text-slate-400 uppercase tracking-wider">#{tag}</span>
                    ))}
                </div>
                <button
                    type="button"
                    onClick={(e) => {
                        e.stopPropagation();
                        onInspect(project);
                    }}
                    className="text-sm font-bold text-cyan-400 hover:text-cyan-300 inline-flex items-center gap-1 group-hover:translate-x-1 transition-all"
                >
                    View Case Study <ArrowRight className="w-4 h-4" />
                </button>
            </div>
        </div>
    </div>
);

const SkillCategory: React.FC<{ title: string; skills: string[]; thermalGuard: boolean }> = ({ title, skills, thermalGuard }) => (
    <div className={`bg-[#070F20]/65 ${thermalGuard ? '' : 'backdrop-blur-xl'} border border-white/10 rounded-2xl p-7 hover:border-violet-500/35 transition-all group`}>
        <h4 className="text-lg font-bold text-white mb-4 flex items-center gap-2.5">
            <span className="w-2.5 h-2.5 rounded-full bg-violet-500" />
            {title}
        </h4>
        <div className="flex flex-wrap gap-2">
            {skills.map((skill) => (
                <span key={skill} className="px-3 py-1.5 bg-[#0D1117] border border-white/10 rounded-lg text-xs font-medium text-slate-300">
                    {skill}
                </span>
            ))}
        </div>
    </div>
);

const PortfolioPage: React.FC<PortfolioPageProps> = ({ onSignUp, onOpenBriefing }) => {
    const [selectedProject, setSelectedProject] = useState<PortfolioProject | null>(null);
    const thermalGuard = isThermalGuardActive();

    const coreSkills = ['Python (Pandas, NumPy)', 'Rust Execution', 'Orderbook Microstructure', 'Volatility Regimes', 'Statistical Arbitrage'];
    const mlSkills = ['PyTorch & TensorFlow', 'LSTM Sequence Models', 'WallHunter Scoring', 'Feature Pipelines', 'Market Sentiment NLP'];
    const infraSkills = ['Docker & Cloud Nodes', 'WebSocket Adapters', 'Binance / Bybit / OKX', 'TimescaleDB', 'Trade-Only AES Encryption'];

    useEffect(() => {
        if (!selectedProject) return;
        const onKeyDown = (e: KeyboardEvent) => {
            if (e.key === 'Escape') setSelectedProject(null);
        };
        window.addEventListener('keydown', onKeyDown);
        return () => window.removeEventListener('keydown', onKeyDown);
    }, [selectedProject]);

    return (
        <div className="bg-transparent text-white min-h-screen selection:bg-cyan-500/30 selection:text-cyan-200">
            {/* Hero Section */}
            <div className="relative pt-24 pb-16 overflow-hidden">
                <div className="absolute inset-0 z-0 pointer-events-none">
                    <div
                        className="absolute inset-0 opacity-10"
                        style={{
                            backgroundImage: 'linear-gradient(rgba(6,182,212,0.15) 1px, transparent 1px), linear-gradient(90deg, rgba(6,182,212,0.15) 1px, transparent 1px)',
                            backgroundSize: '40px 40px',
                        }}
                    />
                    {!thermalGuard && (
                        <>
                            <div className="absolute top-16 left-1/4 w-[460px] h-[460px] bg-cyan-500/10 rounded-full blur-[130px] animate-float-medium" />
                            <div className="absolute top-36 right-1/4 w-[380px] h-[380px] bg-violet-600/10 rounded-full blur-[110px] animate-float-slow" />
                        </>
                    )}
                </div>

                <div className="container mx-auto px-4 sm:px-6 lg:px-8 text-center relative z-10">
                    <span className="inline-flex items-center gap-2 py-1 px-3.5 rounded-full bg-cyan-500/10 text-cyan-400 text-xs font-bold tracking-widest uppercase mb-6 border border-cyan-500/20">
                        <span className="w-1.5 h-1.5 rounded-full bg-cyan-400 animate-pulse" />
                        Case Studies &amp; Benchmarks
                    </span>
                    <h1 className="text-4xl sm:text-5xl md:text-7xl font-extrabold text-white tracking-tight mb-6">
                        Production Quant <span className="text-transparent bg-clip-text bg-gradient-to-r from-cyan-400 via-violet-400 to-pink-400">Architecture</span>
                    </h1>
                    <p className="max-w-2xl mx-auto text-lg text-slate-400 leading-relaxed font-light">
                        Explore how CosmoQuantAI powers systematic execution, real-time order-book wall detection, and regime-aware risk controls across active trading desks.
                    </p>
                </div>
            </div>

            <div className="container mx-auto px-4 sm:px-6 lg:px-8 space-y-20 pb-24">
                {/* Featured Case Studies */}
                <section className="relative z-10">
                    <div className="flex items-center justify-between mb-10">
                        <h2 className="text-3xl font-extrabold text-white tracking-tight">System Case Studies</h2>
                        <div className="hidden md:block h-px flex-1 bg-gradient-to-r from-cyan-500/40 to-transparent ml-8" />
                    </div>
                    <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-7">
                        {MOCK_PORTFOLIO_PROJECTS.map((project, index) => (
                            <ProjectCard
                                key={project.id}
                                project={project}
                                index={index}
                                thermalGuard={thermalGuard}
                                onInspect={setSelectedProject}
                            />
                        ))}
                    </div>
                </section>

                {/* Tech Stack */}
                <section className="relative z-10">
                    <h2 className="text-3xl font-extrabold text-white mb-10 text-center tracking-tight">Technology Stack</h2>
                    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
                        <SkillCategory title="Core Quantitative Engines" skills={coreSkills} thermalGuard={thermalGuard} />
                        <SkillCategory title="AI & Signal Intelligence" skills={mlSkills} thermalGuard={thermalGuard} />
                        <SkillCategory title="Execution Infrastructure" skills={infraSkills} thermalGuard={thermalGuard} />
                    </div>
                </section>

                {/* Testimonials */}
                <section className="relative z-10">
                    <h2 className="text-3xl font-extrabold text-white mb-10 text-center tracking-tight">What Desks Say</h2>
                    <div className="grid grid-cols-1 lg:grid-cols-3 gap-7">
                        {MOCK_CLIENT_TESTIMONIALS.map((testimonial) => (
                            <div
                                key={testimonial.id}
                                className={`bg-[#070F20]/75 ${thermalGuard ? '' : 'backdrop-blur-md'} p-7 rounded-3xl border border-white/10 relative hover:border-cyan-500/30 transition-all group`}
                            >
                                <div className="text-5xl text-cyan-500/20 font-serif mb-2">&ldquo;</div>
                                <p className="text-slate-300 italic relative z-10 mb-7 leading-relaxed text-sm">
                                    {testimonial.quote}
                                </p>
                                <div className="flex items-center gap-3.5 border-t border-white/10 pt-5">
                                    <div className="w-10 h-10 rounded-xl bg-gradient-to-br from-cyan-500/20 to-violet-600/20 border border-white/10 flex items-center justify-center text-sm font-bold text-cyan-300">
                                        {testimonial.author[0]}
                                    </div>
                                    <div>
                                        <p className="font-bold text-sm text-white">{testimonial.author}</p>
                                        <p className="text-xs text-slate-400 font-mono">{testimonial.role}</p>
                                    </div>
                                </div>
                            </div>
                        ))}
                    </div>
                </section>

                {/* CTA Section */}
                <section className={`relative rounded-[2rem] overflow-hidden bg-[#070F20]/85 ${thermalGuard ? '' : 'backdrop-blur-2xl'} border border-cyan-500/25 text-white py-16 px-8 text-center shadow-[0_0_50px_rgba(6,182,212,0.12)]`}>
                    <div className="absolute top-0 left-0 right-0 h-1 bg-gradient-to-r from-cyan-500 via-violet-500 to-pink-500" />
                    <div className="relative z-10 max-w-3xl mx-auto">
                        <h2 className="text-3xl md:text-5xl font-extrabold tracking-tight mb-5">
                            Ready to Automate Your Strategy?
                        </h2>
                        <p className="text-lg text-slate-400 mb-9 leading-relaxed max-w-2xl mx-auto">
                            Launch a free Paper Trading workspace in seconds, or book a technical briefing with CosmoQuantAI engineers for custom desk integrations.
                        </p>
                        <div className="flex flex-col sm:flex-row gap-4 justify-center">
                            <button
                                type="button"
                                onClick={onSignUp}
                                className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-bold bg-gradient-to-r from-cyan-500 to-violet-600 text-white shadow-[0_0_20px_rgba(6,182,212,0.3)] hover:shadow-[0_0_30px_rgba(6,182,212,0.5)] transition-all hover:scale-[1.02]"
                            >
                                Launch Free Workspace
                                <ArrowRight className="w-4 h-4" />
                            </button>
                            <button
                                type="button"
                                onClick={() => onOpenBriefing?.('custom_algo')}
                                className="inline-flex items-center justify-center gap-2 px-8 py-4 rounded-xl font-bold bg-[#0D1117] border border-white/15 hover:border-cyan-500/40 hover:bg-white/5 text-white transition-all"
                            >
                                <Calendar className="w-4 h-4 text-cyan-400" />
                                Book Technical Briefing
                            </button>
                        </div>
                    </div>
                </section>
            </div>

            {/* Case Study Detail Modal */}
            {selectedProject && (
                <div
                    className={`fixed inset-0 z-[120] flex items-center justify-center p-4 bg-black/75 ${thermalGuard ? '' : 'backdrop-blur-md'}`}
                    onClick={() => setSelectedProject(null)}
                >
                    <div
                        className="relative w-full max-w-2xl rounded-3xl bg-[#070F20] border border-cyan-500/25 shadow-2xl overflow-hidden max-h-[90vh] overflow-y-auto"
                        onClick={(e) => e.stopPropagation()}
                    >
                        <div className="h-1 bg-gradient-to-r from-cyan-500 via-violet-500 to-emerald-400" />
                        <button
                            type="button"
                            onClick={() => setSelectedProject(null)}
                            aria-label="Close case study"
                            className="absolute top-4 right-4 z-20 w-9 h-9 rounded-xl bg-black/60 border border-white/15 text-slate-300 hover:text-white flex items-center justify-center"
                        >
                            <X className="w-4 h-4" />
                        </button>

                        <div className="h-48 relative border-b border-white/10">
                            <img src={selectedProject.imageUrl} alt={selectedProject.title} className="w-full h-full object-cover" />
                            <span className="absolute bottom-4 left-6 px-3 py-1 rounded-full bg-[#020610]/90 border border-cyan-500/30 text-xs font-bold text-cyan-300">
                                {selectedProject.category}
                            </span>
                        </div>

                        <div className="p-6 sm:p-8 space-y-6">
                            <div>
                                <h3 className="text-2xl font-extrabold text-white mb-2">{selectedProject.title}</h3>
                                <p className="text-sm text-slate-300 leading-relaxed">{selectedProject.description}</p>
                            </div>

                            <div className="grid grid-cols-3 gap-3">
                                {selectedProject.metrics.map((m) => (
                                    <MetricBadge key={m.label} label={m.label} value={m.value} />
                                ))}
                            </div>

                            {selectedProject.architecture && (
                                <div className="p-4 rounded-2xl bg-[#0D1117] border border-white/10">
                                    <p className="text-[11px] font-bold uppercase tracking-wider text-cyan-400 mb-1.5 flex items-center gap-1.5">
                                        <Cpu className="w-3.5 h-3.5" /> Pipeline Architecture
                                    </p>
                                    <p className="text-xs font-mono text-slate-300 leading-relaxed">{selectedProject.architecture}</p>
                                </div>
                            )}

                            {selectedProject.highlights && (
                                <div>
                                    <p className="text-[11px] font-bold uppercase tracking-wider text-slate-400 mb-2.5 flex items-center gap-1.5">
                                        <Layers className="w-3.5 h-3.5 text-violet-400" /> Key Capabilities
                                    </p>
                                    <ul className="space-y-2">
                                        {selectedProject.highlights.map((h) => (
                                            <li key={h} className="flex items-start gap-2 text-sm text-slate-300">
                                                <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0 mt-0.5" />
                                                <span>{h}</span>
                                            </li>
                                        ))}
                                    </ul>
                                </div>
                            )}

                            <div className="flex flex-col sm:flex-row gap-3 pt-2 border-t border-white/10">
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSelectedProject(null);
                                        onSignUp();
                                    }}
                                    className="flex-1 py-3 px-5 rounded-xl font-bold text-sm bg-gradient-to-r from-cyan-500 to-violet-600 text-white"
                                >
                                    Try in Workspace
                                </button>
                                <button
                                    type="button"
                                    onClick={() => {
                                        setSelectedProject(null);
                                        onOpenBriefing?.('custom_algo');
                                    }}
                                    className="py-3 px-5 rounded-xl font-semibold text-sm bg-white/5 border border-white/10 text-slate-200 hover:bg-white/10"
                                >
                                    Request Similar Build
                                </button>
                            </div>
                        </div>
                    </div>
                </div>
            )}
        </div>
    );
};

export default PortfolioPage;
