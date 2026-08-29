import { useMemo, useState } from "react";
import {
  ArrowLeftIcon,
  ArrowRightIcon,
  CheckCircledIcon,
  DrawingPinIcon,
  MagicWandIcon,
  ReloadIcon,
} from "@radix-ui/react-icons";
import {
  DIALECT_PERSONALITY_DIMENSIONS,
  computeDialectPersonality,
  createDialectQuestionSequence,
  getDialectPersonalityQuestion,
} from "./personality/dialectPersonalityModel.js";
import { buildBeijingPersonalityAttractions } from "./personality/beijingAttractionProfiles.js";
import { generatePersonalizedRoute } from "./personality/personalizedRouteGenerator.js";
import { assetUrl } from "./assetUrl.js";
import "./personality.css";

const axisShortLabels = {
  action: "行动",
  novelty: "新奇",
  social: "社交",
  structure: "结构",
};

const groupStopsByDay = (stops = []) => stops.reduce((groups, stop) => {
  if (!groups.has(stop.day)) groups.set(stop.day, []);
  groups.get(stop.day).push(stop);
  return groups;
}, new Map());

export function PersonalityJourneyPage({ places = [], onBack, onUseRoute }) {
  const [phase, setPhase] = useState("intro");
  const [questionIds, setQuestionIds] = useState(() => createDialectQuestionSequence());
  const [questionIndex, setQuestionIndex] = useState(0);
  const [answers, setAnswers] = useState({});
  const [personalityResult, setPersonalityResult] = useState(null);
  const [route, setRoute] = useState(null);
  const [variant, setVariant] = useState(0);
  const [selectedDay, setSelectedDay] = useState(1);
  const [errorMessage, setErrorMessage] = useState("");

  const attractions = useMemo(
    () => buildBeijingPersonalityAttractions(places),
    [places],
  );
  const currentQuestion = getDialectPersonalityQuestion(questionIds[questionIndex]);
  const selectedOptionId = currentQuestion ? answers[currentQuestion.id] : null;
  const progress = Math.round(((questionIndex + 1) / questionIds.length) * 100);
  const stopsByDay = useMemo(() => groupStopsByDay(route?.stops), [route]);

  const resetQuiz = () => {
    setQuestionIds((previous) => createDialectQuestionSequence(Math.random, previous));
    setQuestionIndex(0);
    setAnswers({});
    setPersonalityResult(null);
    setRoute(null);
    setVariant(0);
    setSelectedDay(1);
    setErrorMessage("");
    setPhase("quiz");
  };

  const finishQuiz = (finalAnswers) => {
    const result = computeDialectPersonality(finalAnswers, questionIds);
    if (!result.isComplete) {
      setErrorMessage("这组答案暂时无法形成完整四维结果，请返回检查后重试。");
      return;
    }
    const generated = generatePersonalizedRoute(result, attractions, { variant: 0 });
    if (!generated) {
      setErrorMessage("当前可用景点不足以生成路线，请稍后补充景点数据再试。");
      return;
    }
    setPersonalityResult(result);
    setRoute(generated);
    setVariant(0);
    setSelectedDay(1);
    setErrorMessage("");
    setPhase("result");
  };

  const handleNext = () => {
    if (!currentQuestion || !selectedOptionId) return;
    if (questionIndex >= questionIds.length - 1) {
      finishQuiz(answers);
      return;
    }
    setQuestionIndex((current) => current + 1);
    setErrorMessage("");
  };

  const regenerateRoute = () => {
    if (!personalityResult) return;
    const nextVariant = variant + 1;
    const generated = generatePersonalizedRoute(personalityResult, attractions, {
      variant: nextVariant,
    });
    if (!generated) {
      setErrorMessage("这次没有生成可用组合，当前路线保持不变。");
      return;
    }
    setVariant(nextVariant);
    setRoute(generated);
    setSelectedDay(1);
    setErrorMessage("");
  };

  if (phase === "intro") {
    return (
      <main className="page personality-page personality-intro" data-personality-phase="intro">
        <button type="button" className="personality-back" onClick={onBack}>
          <ArrowLeftIcon /> 返回路线发现
        </button>
        <section className="personality-intro-card">
          <div className="personality-intro-copy">
            <span className="personality-kicker"><MagicWandIcon /> 串 Knot 人格路线</span>
            <h1>先认识你的旅行节奏，再把北京串成一条路</h1>
            <p>
              从18道生活情境中随机抽取15道，计算行动、新奇、社交和结构四个维度，
              再从当前北京景点库中完成去重、匹配、选点、串联与分日。
            </p>
            <div className="personality-intro-facts" aria-label="测评说明">
              <span><strong>15</strong> 道随机题</span>
              <span><strong>4</strong> 个连续维度</span>
              <span><strong>16</strong> 种方言人格</span>
              <span><strong>{attractions.length}</strong> 个当前候选</span>
            </div>
            <button type="button" className="personality-primary" onClick={resetQuiz}>
              开始测评 <ArrowRightIcon />
            </button>
          </div>
          <aside className="personality-algorithm-card" aria-label="路线生成步骤">
            <small>本地确定性算法</small>
            <ol>
              <li><span>01</span>四维百分比</li>
              <li><span>02</span>景点名称去重</li>
              <li><span>03</span>人格兼容评分</li>
              <li><span>04</span>聚簇与确定性抽样</li>
              <li><span>05</span>最近邻与时间窗分日</li>
            </ol>
            <p>相同答案和相同变体会得到相同结果，不调用模型随机编写路线。</p>
          </aside>
        </section>
      </main>
    );
  }

  if (phase === "quiz") {
    return (
      <main className="page personality-page personality-quiz" data-personality-phase="quiz">
        <header className="personality-quiz-header">
          <button type="button" className="personality-back" onClick={() => setPhase("intro")}>
            <ArrowLeftIcon /> 暂停测评
          </button>
          <span>第 {questionIndex + 1} / {questionIds.length} 题</span>
        </header>
        <div className="personality-progress" aria-label={`测评进度 ${progress}%`}>
          <span style={{ width: `${progress}%` }} />
        </div>

        <section className="personality-question-card" aria-labelledby="personality-question-title">
          <span className="personality-question-symbol" aria-hidden="true">
            {currentQuestion?.symbol}
          </span>
          <small>{currentQuestion?.eyebrow}</small>
          <h1 id="personality-question-title">{currentQuestion?.prompt}</h1>
          <div className="personality-options" role="radiogroup" aria-label="请选择更像你的答案">
            {currentQuestion?.options.map((option, index) => {
              const selected = selectedOptionId === option.id;
              return (
                <button
                  type="button"
                  role="radio"
                  aria-checked={selected}
                  className={selected ? "selected" : ""}
                  key={`${currentQuestion.id}-${option.id}-${index}`}
                  onClick={() => {
                    setAnswers((current) => ({ ...current, [currentQuestion.id]: option.id }));
                    setErrorMessage("");
                  }}
                >
                  <span>{String.fromCharCode(65 + index)}</span>
                  <strong>{option.label}</strong>
                  {selected ? <CheckCircledIcon /> : null}
                </button>
              );
            })}
          </div>
          {errorMessage ? <p className="personality-error" role="alert">{errorMessage}</p> : null}
          <footer className="personality-question-actions">
            <button
              type="button"
              className="personality-secondary"
              disabled={questionIndex === 0}
              onClick={() => setQuestionIndex((current) => Math.max(0, current - 1))}
            >
              <ArrowLeftIcon /> 上一题
            </button>
            <button
              type="button"
              className="personality-primary"
              disabled={!selectedOptionId}
              onClick={handleNext}
            >
              {questionIndex === questionIds.length - 1 ? "生成我的路线" : "下一题"}
              <ArrowRightIcon />
            </button>
          </footer>
        </section>
      </main>
    );
  }

  const persona = personalityResult?.personality;

  return (
    <main className="page personality-page personality-result" data-personality-phase="result">
      <header className="personality-result-header">
        <div>
          <span className="personality-kicker"><CheckCircledIcon /> 四维倾向已计算</span>
          <h1>{persona?.dialectName} · {persona?.archetype}</h1>
          <p>{persona?.description}</p>
        </div>
        <div className="personality-code-badge">
          <small>人格代码</small>
          <strong>{personalityResult?.personalityCode}</strong>
          <span>{personalityResult?.profileStrengthPercentage}% 倾向强度</span>
        </div>
      </header>

      <section className="personality-dimensions" aria-label="四维人格结果">
        {DIALECT_PERSONALITY_DIMENSIONS.map((definition) => {
          const dimension = personalityResult?.dimensionResults.find(({ id }) => id === definition.id);
          return (
            <article key={definition.id}>
              <header>
                <span>{axisShortLabels[definition.id]}</span>
                <strong>{dimension?.selectedLabel}</strong>
              </header>
              <div className="personality-dimension-bar">
                <span style={{ width: `${dimension?.leftPercentage ?? 50}%` }} />
              </div>
              <footer>
                <span>{definition.leftCode} {dimension?.leftPercentage}%</span>
                <span>{dimension?.rightPercentage}% {definition.rightCode}</span>
              </footer>
            </article>
          );
        })}
      </section>

      <section className="personality-route-card">
        <header className="personality-route-heading">
          <div>
            <span className="personality-kicker"><MagicWandIcon /> 算法生成路线</span>
            <h2>{route?.title}</h2>
            <p>{route?.summary}</p>
          </div>
          <div className="personality-match-score">
            <strong>{route?.matchScore}%</strong>
            <span>算法匹配度</span>
          </div>
        </header>

        <div className="personality-route-facts">
          <span><DrawingPinIcon />{route?.days}</span>
          <span>唯一候选 {route?.facts.candidateCount} 个</span>
          <span>重名去除 {route?.facts.duplicateExcluded} 个</span>
          <span>平均转场 {route?.facts.averageSegmentKm} km</span>
        </div>

        <div className="personality-day-tabs" role="tablist" aria-label="选择行程日">
          {[...stopsByDay.keys()].map((day) => (
            <button
              type="button"
              role="tab"
              aria-selected={selectedDay === day}
              className={selectedDay === day ? "active" : ""}
              key={day}
              onClick={() => setSelectedDay(day)}
            >
              Day {day}
            </button>
          ))}
        </div>

        <div className="personality-stop-list">
          {(stopsByDay.get(selectedDay) ?? []).map((stop, index) => (
            <article key={`${stop.id}-${stop.day}`}>
              <span className="personality-stop-index">{index + 1}</span>
              <img src={assetUrl(stop.source?.image)} alt="" loading="lazy" decoding="async" />
              <div>
                <small>{stop.displayTime} · {stop.durationMinutes} 分钟</small>
                <strong>{stop.name}</strong>
                <p>{stop.reason}</p>
              </div>
              <em>{Math.round(stop.fit)} 分</em>
            </article>
          ))}
        </div>

        {errorMessage ? <p className="personality-error" role="alert">{errorMessage}</p> : null}
        <footer className="personality-result-actions">
          <button type="button" className="personality-secondary" onClick={resetQuiz}>
            重新测试
          </button>
          <button type="button" className="personality-secondary" onClick={regenerateRoute}>
            <ReloadIcon /> 换一组景点
          </button>
          <button
            type="button"
            className="personality-primary"
            onClick={() => onUseRoute?.(route, selectedDay)}
          >
            将 Day {selectedDay} 加入规划画布 <ArrowRightIcon />
          </button>
        </footer>
      </section>
    </main>
  );
}

export default PersonalityJourneyPage;
