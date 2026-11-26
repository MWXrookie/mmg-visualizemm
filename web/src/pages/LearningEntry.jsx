import React, { useEffect, useRef } from 'react'
import { IconArrowLeft, IconChevronRight, IconMoon, IconSun } from '../components/Icons.jsx'
import SecondaryCards from './SecondaryCards.jsx'
import './learning-entry.css'

export default function LearningEntry({ view, theme, onToggleTheme, resumeWorkspace, onStart, onResume }) {
  const heading = useRef(null)

  useEffect(() => {
    heading.current?.focus({ preventScroll: true })
  }, [view])

  const isHome = view === 'home'
  const isUniversity = view === 'university'
  const title = isHome ? '数学建模工作台' : isUniversity ? '大学生学习' : '中学生学习'

  return (
    <div className="learning-entry">
      <header className="learning-entry-header">
        {isHome
          ? <span className="learning-entry-brand">MMG</span>
          : <a className="learning-entry-back" href="#/home"><IconArrowLeft size={16} /> 返回主页</a>}
        <button
          type="button"
          className="btn btn-ghost"
          onClick={onToggleTheme}
          aria-label={theme === 'dark' ? '切换浅色' : '切换深色'}
        >
          {theme === 'dark' ? <IconSun size={16} /> : <IconMoon size={16} />}
        </button>
      </header>

      <section className="learning-entry-body" aria-labelledby="learning-entry-title">
        <h1 id="learning-entry-title" ref={heading} tabIndex={-1}>{title}</h1>
        {isHome && (
          <nav className="learning-section-links" aria-label="学习分区">
            <a className="card learning-section-link" href="#/university">
              <h2>大学生学习</h2>
              <p>带自己的题目，从读题、梳理思路到编程验证。</p>
              <IconChevronRight size={19} />
            </a>
            <a className="card learning-section-link" href="#/secondary">
              <h2>中学生学习</h2>
              <p>面向初中和高中的数学建模学习。</p>
              <IconChevronRight size={19} />
            </a>
          </nav>
        )}
        {isUniversity && (
          <div className="card learning-entry-panel">
            <p>粘贴或上传自己的题目。先挑一个想弄清的问题，想一想目标是什么、题目给了哪些条件、你卡在哪里。</p>
            <div className="learning-entry-actions">
              <button type="button" className="btn btn-primary" onClick={onStart}>导入自己的题目</button>
              {resumeWorkspace && (
                <button type="button" className="btn btn-ghost" onClick={() => onResume(resumeWorkspace.id)}>继续学习</button>
              )}
            </div>
            {resumeWorkspace && <p className="learning-resume-title">最近学习 · {resumeWorkspace.title || '未命名题目'}</p>}
          </div>
        )}
        {view === 'secondary' && (
          <>
            <SecondaryCards />
            <p className="learning-entry-description secondary-course-note">课堂案例工作台筹备中。</p>
          </>
        )}
      </section>
    </div>
  )
}
